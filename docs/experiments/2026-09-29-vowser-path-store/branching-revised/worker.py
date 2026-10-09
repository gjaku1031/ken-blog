"""동결된 원본 3군과 outer STRAIGHT_JOIN 한 군의 단일 DB worker."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import time
from collections import Counter
from pathlib import Path

import psutil

from branching import bench
from branching.model import FIELDS, Model, digest, stable_json
from branching.storage import (load_mysql,load_neo,mysql_statement,
                               verify_engine_membership,cleanup_engine)
from branching.worker import capture_engine_plans,oracle_exhaustive_cases
from manifest import RESULTS, verify, verify_cell, write_json
from rawcheck import FIELDS as RAW_FIELDS, engine_modes, input_rows
from shared.connect import mysql_connection, neo4j_driver

ORDERED = 'mysql_member_ordered'
BASE_MYSQL_QUERY = bench.mysql_query


def ordered_statement(cell: str, case: dict, depth_limit: int) -> tuple[str,tuple]:
    original,params = mysql_statement('mysql_member',cell,case,depth_limit)
    marker = 'SELECT e.path_id'
    replacement = 'SELECT STRAIGHT_JOIN e.path_id'
    if original.count(marker) != 1:
        raise AssertionError('original membership outer SELECT shape changed')
    ordered = original.replace(marker,replacement,1)
    if ordered.replace(replacement,marker,1) != original:
        raise AssertionError('ordered SQL differs beyond STRAIGHT_JOIN')
    return ordered,params


def revised_mysql_query(con, mode: str, cell: str, case: dict,
                        depth_limit: int = 20) -> list[dict]:
    if mode == ORDERED:
        sql,params = ordered_statement(cell,case,depth_limit)
        with con.cursor() as cur:
            cur.execute(sql,params)
            raw = cur.fetchall()
        return [dict(zip(FIELDS,row)) for row in raw]
    if mode == 'mysql_adj':
        return BASE_MYSQL_QUERY(con,mode,cell,case,depth_limit)
    raise ValueError(f'unrecognized MySQL revised mode: {mode}')


# bench.run_one의 기존 요청 경계·정규화·독립 오라클을 네 군에 공통 적용.
bench.mysql_query = revised_mysql_query


def worker_limits() -> dict:
    cpu = Path('/sys/fs/cgroup/cpu.max').read_text().split()
    memory = Path('/sys/fs/cgroup/memory.max').read_text().strip()
    if cpu[0] == 'max' or int(cpu[0]) != int(cpu[1]) or int(memory) != 1024**3:
        raise AssertionError(f'worker resource contract changed: cpu={cpu}, memory={memory}')
    return {'cpu_max':cpu,'memory_max_bytes':int(memory)}


def connection():
    con = mysql_connection()
    with con.cursor() as cur:
        cur.execute('SET SESSION MAX_EXECUTION_TIME=2000')
    return con


def health(engine: str) -> None:
    limits = worker_limits()
    if engine == 'mysql':
        con = connection()
        try:
            with con.cursor() as cur:
                cur.execute('SELECT 1')
                assert cur.fetchone()[0] == 1
        finally:
            con.close()
    else:
        driver = neo4j_driver()
        try:
            with driver.session(database='neo4j') as session:
                assert session.run('RETURN 1 AS ok').single()['ok'] == 1
        finally:
            driver.close()
    print(json.dumps({'engine':engine,'health':'ready','worker_limits':limits}),flush=True)


def frozen_cases(model: Model) -> list[dict]:
    verify_cell(model.cell)
    cases,expected = input_rows(RESULTS/model.cell)
    generated = model.cases()
    if cases != generated or any(row['rows'] != model.oracle(case)
                                 for case,row in zip(cases,expected)):
        raise AssertionError(f'Model-generated cases/oracle changed: {model.cell}')
    return cases


def mysql_plan(con, model: Model, case: dict) -> dict:
    sql,params = ordered_statement(model.cell,case,model.depth_limit)
    record = {'case_id':case['case_id'],'expected_paths':case['oracle_paths'],
              'sql_sha256':hashlib.sha256(sql.encode()).hexdigest(),
              'checks':{},'passed':False}
    try:
        with con.cursor() as cur:
            cur.execute('EXPLAIN FORMAT=JSON '+sql,params)
            raw = cur.fetchone()[0]
        record['raw_explain_json'] = raw
        plan = json.loads(raw)
        record['plan'] = plan
        loop = plan['query_block']['ordering_operation']['nested_loop']
        tables = [item['table'] for item in loop]
        names = [item.get('table_name') for item in tables]
        member_parts = tables[1].get('used_key_parts',[]) if len(tables)>1 else []
        step_parts = tables[2].get('used_key_parts',[]) if len(tables)>2 else []
        checks = {
            'outer_join_order_e_m_s':names == ['e','m','s'],
            'eligible_materialized':bool(tables and 'materialized_from_subquery' in tables[0]),
            'member_ref_condition_path':len(tables)>1 and tables[1].get('access_type')=='ref'
                and tables[1].get('key') in ('PRIMARY','br3_member_path_step')
                and member_parts[:2]==['condition_id','path_id'],
            'step_eq_ref_primary_condition_step':len(tables)>2
                and tables[2].get('access_type')=='eq_ref' and tables[2].get('key')=='PRIMARY'
                and step_parts[:2]==['condition_id','step_id'],
        }
        record['checks'] = checks
        record['passed'] = all(checks.values())
    except Exception as exc:
        record['guard_error_type'] = type(exc).__name__
        record['guard_error'] = str(exc)[:500]
    return record


def capture_plans(model: Model, cases: list[dict], engine: str) -> dict:
    answerable = next((c for c in cases if c['oracle_paths']==3),None)
    empty = next((c for c in cases if c['oracle_paths']==0),None)
    if answerable is None or empty is None:
        raise AssertionError('representative answerable/empty cases missing')
    if engine == 'neo4j':
        return {'answerable':capture_engine_plans(model,answerable,engine),
                'empty':capture_engine_plans(model,empty,engine)}
    con = connection()
    try:
        plans = {}
        for label,case in (('answerable',answerable),('empty',empty)):
            sql,params = mysql_statement('mysql_adj',model.cell,case,model.depth_limit)
            with con.cursor() as cur:
                cur.execute('EXPLAIN FORMAT=JSON '+sql,params)
                raw = cur.fetchone()[0]
            plans[label] = {'mysql_adj':{'raw_explain_json':raw,'plan':json.loads(raw)},
                            ORDERED:mysql_plan(con,model,case)}
        return plans
    finally:
        con.close()


def load_verify(model: Model, engine: str, cases: list[dict], out: Path) -> dict:
    started = time.monotonic()
    loaded = load_mysql(model) if engine == 'mysql' else load_neo(model)
    expected = ({'br3_path':len(model.paths),'br3_step':len(model.steps),
                 'br3_member':len(model.members),'br3_next':len(model.next_edges)}
                if engine=='mysql' else
                {'paths':len(model.paths),'steps':len(model.steps),
                 'members':len(model.members),'next_edges':len(model.next_edges)})
    if loaded['counts'] != expected:
        raise AssertionError(f'{engine} fixture count mismatch: {loaded["counts"]}')
    verified = verify_engine_membership(model,engine)
    plans = capture_plans(model,cases,engine)
    write_json(out/f'plans-{engine}.json',plans)
    state = 'ready'
    if engine=='mysql' and not plans['answerable'][ORDERED]['passed']:
        state = 'plan_guard_failed'
    result = {'cell':model.cell,'engine':engine,'state':state,'loaded':loaded,
              'full_membership':verified,'worker_limits':worker_limits(),
              'elapsed_seconds':time.monotonic()-started,
              'input_sha256':__import__('manifest').sha(out/'input.json')}
    write_json(out/f'load-{engine}.json',result)
    if state != 'ready':
        raise AssertionError('ordered MySQL outer plan guard failed; no arbitrary retuning')
    return result


def prepare(model: Model, engine: str) -> None:
    verify()
    cases = frozen_cases(model)
    out = RESULTS/model.cell
    load_verify(model,engine,cases,out)
    print(json.dumps({'prepared':model.cell,'engine':engine,
                      'membership_rows':len(model.members)}),flush=True)


def block(model: Model, engine: str, round_number: int, seconds_left: float) -> None:
    verify()
    if round_number not in (0,1,2):
        raise ValueError('round outside 0..2')
    cases = frozen_cases(model)
    out = RESULTS/model.cell
    loaded = json.loads((out/f'load-{engine}.json').read_text())
    if loaded['state'] != 'ready':
        raise AssertionError(f'{engine} fixture/plan not ready')
    modes = engine_modes(engine)
    if round_number % 2:
        modes = modes[::-1]
    raw_path = out/f'raw-{engine}-r{round_number}.csv'
    summary_path = out/f'block-{engine}-r{round_number}.json'
    deadline = time.monotonic()+max(0,seconds_left)
    counts = Counter()
    failures = Counter()
    complete = True
    con = connection() if engine=='mysql' else None
    driver = neo4j_driver() if engine=='neo4j' else None
    session = driver.session(database='neo4j') if driver else None
    peak_rss = 0
    try:
        with raw_path.open('x',newline='') as file:
            writer = csv.DictWriter(file,fieldnames=RAW_FIELDS)
            writer.writeheader()
            for mode in modes:
                for phase in ('warmup','measure'):
                    for case in cases:
                        if time.monotonic() >= deadline:
                            complete = False
                            break
                        if con and not con.open:
                            con.close()
                            con = connection()
                        row = bench.run_one(model,case,mode,con,session,phase,round_number)
                        writer.writerow(row)
                        counts[(phase,mode)] += 1
                        if not row['correct']:
                            failures[(phase,mode,row['error_type'])] += 1
                        peak_rss = max(peak_rss,psutil.Process().memory_info().rss)
                        if session and row['error_type'] not in ('','WrongResult'):
                            session.close()
                            session = driver.session(database='neo4j')
                    file.flush()
                    if not complete:
                        break
                if not complete:
                    break
    finally:
        if session: session.close()
        if driver: driver.close()
        if con: con.close()
    summary = {'cell':model.cell,'engine':engine,'round':round_number,
               'complete':complete,'counts':{str(k):v for k,v in counts.items()},
               'failures':{str(k):v for k,v in failures.items()},
               'worker_peak_sampled_rss_bytes':peak_rss,
               'worker_limits':worker_limits()}
    write_json(summary_path,summary)
    print(json.dumps({'block':model.cell,'engine':engine,'round':round_number,
                      'complete':complete,'attempts':sum(counts.values())}),flush=True)


def smoke(model: Model, engine: str, stress: bool) -> None:
    verify()
    out = RESULTS/('smoke-stress-'+model.cell if stress else 'smoke-base-'+model.cell)
    out.mkdir(parents=True,exist_ok=True)
    cases = model.cases() if stress else oracle_exhaustive_cases(model)
    input_data = {'cell':model.cell,'seed':20260929,'cases':cases,
                  'stats':model.stats(),
                  'oracle_manifest_sha256':digest([c['oracle_sha256'] for c in cases])}
    if (out/'input.json').exists():
        if json.loads((out/'input.json').read_text()) != json.loads(stable_json(input_data)):
            raise AssertionError('smoke inputs changed between engines')
    else:
        write_json(out/'input.json',input_data)
        with (out/'expected.jsonl').open('x') as file:
            for case in cases:
                file.write(stable_json({'case_id':case['case_id'],
                    'rows':model.oracle(case),'sha256':case['oracle_sha256']}).decode()+'\n')
    try:
        load_verify(model,engine,cases,out)
        con = connection() if engine=='mysql' else None
        driver = neo4j_driver() if engine=='neo4j' else None
        session = driver.session(database='neo4j') if driver else None
        errors = []
        attempts = 0
        try:
            with (out/f'raw-{engine}.csv').open('x',newline='') as file:
                writer = csv.DictWriter(file,fieldnames=RAW_FIELDS)
                writer.writeheader()
                for case in cases:
                    for mode in engine_modes(engine):
                        row = bench.run_one(model,case,mode,con,session,'smoke',0)
                        writer.writerow(row)
                        attempts += 1
                        if not row['correct']:
                            errors.append(row)
        finally:
            if session: session.close()
            if driver: driver.close()
            if con: con.close()
        write_json(out/f'smoke-{engine}.json',{'engine':engine,'cases':len(cases),
                   'attempts':attempts,'errors':errors,
                   'full_membership_rows':len(model.members)})
        if errors:
            raise AssertionError(f'{engine} smoke wrong/timeout {len(errors)}/{attempts}')
        print(json.dumps({'smoke':'pass','engine':engine,'cell':model.cell,
                          'attempts':attempts}),flush=True)
    finally:
        cleanup_engine(engine)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('command',choices=('health','prepare','block','smoke'))
    parser.add_argument('--engine',choices=('mysql','neo4j'),required=True)
    parser.add_argument('--total',type=int)
    parser.add_argument('--share',type=int)
    parser.add_argument('--cap',type=int)
    parser.add_argument('--depth',type=int,default=None)
    parser.add_argument('--round',type=int,default=0)
    parser.add_argument('--seconds-left',type=float,default=3600)
    parser.add_argument('--stress-smoke',action='store_true')
    args = parser.parse_args()
    if args.command=='health':
        health(args.engine)
        return
    if None in (args.total,args.share,args.cap):
        parser.error('fixture command requires --total --share --cap')
    model = Model(args.total,args.share,args.cap,depth_override=args.depth)
    if args.command=='smoke':
        smoke(model,args.engine,args.stress_smoke)
    elif args.command=='prepare':
        prepare(model,args.engine)
    else:
        block(model,args.engine,args.round,args.seconds_left)


if __name__=='__main__':
    main()
