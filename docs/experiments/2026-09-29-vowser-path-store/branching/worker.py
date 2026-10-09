"""한 번에 DB 하나만 연결하는 준비·round 블록 worker."""

from __future__ import annotations

import argparse
import csv
import json
import time
from collections import Counter
from pathlib import Path

import psutil

from branching.bench import (OUT, RAW_FIELDS, oracle_exhaustive_cases,
                             plan_tree, preflight, run_one,
                             utc_now, write_json)
from branching.model import Model, digest, stable_json
from branching.storage import (NEO_ADJACENCY, NEO_MEMBERSHIP, load_mysql,
                               load_neo, mysql_statement, verify_engine_membership,
                               cleanup_engine)
from shared.connect import mysql_connection, neo4j_driver


def make_model(args) -> Model:
    return Model(args.total,args.share,args.cap,depth_override=args.depth)


def health(engine: str) -> None:
    if engine == 'mysql':
        con = mysql_connection()
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
    print(json.dumps({'engine':engine,'health':'ready'}))


def prepare_inputs(model: Model, out: Path) -> list[dict]:
    out.mkdir(parents=True,exist_ok=True)
    cases = model.cases()
    record = {'cell':model.cell,'seed':20260929,'stats':model.stats(),
              'cases':cases,'oracle_manifest_sha256':digest([c['oracle_sha256'] for c in cases])}
    path = out/'input.json'
    if path.exists():
        if json.loads(path.read_text()) != json.loads(stable_json(record)):
            raise AssertionError('input manifest changed between engines')
    else:
        write_json(path,record)
        with (out/'expected.jsonl').open('x') as file:
            for case in cases:
                file.write(stable_json({'case_id':case['case_id'],'rows':model.oracle(case),
                                        'sha256':case['oracle_sha256']}).decode()+'\n')
    return cases


def capture_engine_plans(model: Model, case: dict, engine: str) -> dict:
    plans = {}
    if engine == 'mysql':
        con = mysql_connection()
        try:
            with con.cursor() as cur:
                for mode in ('mysql_adj','mysql_member'):
                    sql,params = mysql_statement(mode,model.cell,case,model.depth_limit)
                    cur.execute('EXPLAIN FORMAT=JSON '+sql,params)
                    plans[mode] = json.loads(cur.fetchone()[0])
        finally:
            con.close()
    else:
        driver = neo4j_driver()
        try:
            with driver.session(database='neo4j') as session:
                for mode,query in (('neo_adj',NEO_ADJACENCY),('neo_member',NEO_MEMBERSHIP)):
                    if mode == 'neo_adj':
                        query = query.replace('{5,20}',f'{{5,{model.depth_limit}}}')
                    params = dict(cell=model.cell,domain=case['domain'],intent=case['intent'],
                                  auth=case['auth'],blocked=case['blocked'])
                    plans[mode+'_explain'] = plan_tree(session.run('EXPLAIN '+query,**params).consume().plan)
                    plans[mode+'_profile'] = plan_tree(session.run('PROFILE '+query,**params).consume().profile)
        finally:
            driver.close()
    return plans


def prepare(model: Model, engine: str, group: str) -> None:
    preflight(group)
    out = OUT/model.cell
    cases = prepare_inputs(model,out)
    start = time.monotonic()
    loaded = load_mysql(model) if engine == 'mysql' else load_neo(model)
    expected_counts = (
        {'br3_path':len(model.paths),'br3_step':len(model.steps),
         'br3_member':len(model.members),'br3_next':len(model.next_edges)}
        if engine == 'mysql' else
        {'paths':len(model.paths),'steps':len(model.steps),
         'members':len(model.members),'next_edges':len(model.next_edges)}
    )
    if loaded['counts'] != expected_counts:
        raise AssertionError(f'{engine} load count mismatch: {loaded["counts"]}')
    verified = verify_engine_membership(model,engine)
    plans = capture_engine_plans(model,cases[0],engine)
    write_json(out/f'load-{engine}.json',{
        'engine':engine,'loaded':loaded,'full_membership':verified,
        'elapsed_seconds':time.monotonic()-start,'verified_utc':utc_now(),
    })
    write_json(out/f'plans-{engine}.json',plans)
    print(json.dumps({'prepared':model.cell,'engine':engine,'rows':verified['rows'],
                      'seconds':round(time.monotonic()-start,2)}),flush=True)


def block(model: Model, engine: str, round_number: int, seconds_left: float) -> None:
    group = 'stress' if model.depth_override else 'main'
    preflight(group)
    if round_number not in (0,1,2):
        raise ValueError('round outside 0..2')
    cases = model.cases()
    input_path = OUT/model.cell/'input.json'
    saved = json.loads(input_path.read_text())
    if saved['cases'] != cases:
        raise AssertionError('query cases changed after prepare')
    modes = ('mysql_adj','mysql_member') if engine == 'mysql' else ('neo_adj','neo_member')
    if round_number % 2:
        modes = modes[::-1]
    out = OUT/model.cell
    raw_path = out/f'raw-{engine}-r{round_number}.csv'
    summary_path = out/f'block-{engine}-r{round_number}.json'
    deadline = time.monotonic()+max(0,seconds_left)
    counts = Counter()
    failures = Counter()
    complete = True
    con = mysql_connection() if engine == 'mysql' else None
    driver = neo4j_driver() if engine == 'neo4j' else None
    session = driver.session(database='neo4j') if driver else None
    try:
        if con:
            with con.cursor() as cur:
                cur.execute('SET SESSION MAX_EXECUTION_TIME=2000')
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
                            con = mysql_connection()
                            with con.cursor() as cur:
                                cur.execute('SET SESSION MAX_EXECUTION_TIME=2000')
                        row = run_one(model,case,mode,con,session,phase,round_number)
                        writer.writerow(row)
                        counts[(phase,mode)] += 1
                        if not row['correct']:
                            failures[(phase,mode,row['error_type'])] += 1
                        if session and row['error_type'] not in ('','WrongResult'):
                            session.close()
                            session = driver.session(database='neo4j')
                    file.flush()
                    if not complete:
                        break
                if not complete:
                    break
    finally:
        if session:
            session.close()
        if driver:
            driver.close()
        if con:
            con.close()
    summary = {'cell':model.cell,'engine':engine,'round':round_number,
               'complete':complete,'counts':{str(k):v for k,v in counts.items()},
               'failures':{str(k):v for k,v in failures.items()},
               'worker_rss_bytes':psutil.Process().memory_info().rss,
               'finished_utc':utc_now()}
    write_json(summary_path,summary)
    print(json.dumps({'block':model.cell,'engine':engine,'round':round_number,
                      'complete':complete,'attempts':sum(counts.values()),
                      'failures':sum(failures.values())}),flush=True)


def smoke(model: Model, engine: str, stress: bool) -> None:
    preflight('smoke-stress' if stress else 'smoke-v2')
    out = OUT/(('smoke-stress-' if stress else 'smoke-v2-')+model.cell)
    cases = prepare_inputs(model,out)
    test_cases = cases if stress else oracle_exhaustive_cases(model)
    errors = []
    attempts = 0
    try:
        loaded = load_mysql(model) if engine == 'mysql' else load_neo(model)
        verified = verify_engine_membership(model,engine)
        plans = capture_engine_plans(model,cases[0],engine)
        write_json(out/f'load-{engine}.json',{'loaded':loaded,'full_membership':verified,
                                              'verified_utc':utc_now()})
        write_json(out/f'plans-{engine}.json',plans)
        con = mysql_connection() if engine == 'mysql' else None
        driver = neo4j_driver() if engine == 'neo4j' else None
        session = driver.session(database='neo4j') if driver else None
        try:
            if con:
                with con.cursor() as cur:
                    cur.execute('SET SESSION MAX_EXECUTION_TIME=2000')
            with (out/f'raw-{engine}.csv').open('x',newline='') as file:
                writer = csv.DictWriter(file,fieldnames=RAW_FIELDS)
                writer.writeheader()
                modes = ('mysql_adj','mysql_member') if engine == 'mysql' else ('neo_adj','neo_member')
                for case in test_cases:
                    for mode in modes:
                        row = run_one(model,case,mode,con,session,'smoke',0)
                        writer.writerow(row)
                        attempts += 1
                        if not row['correct']:
                            errors.append(row)
        finally:
            if session:
                session.close()
            if driver:
                driver.close()
            if con:
                con.close()
        write_json(out/f'smoke-{engine}.json',{'engine':engine,'cases':len(test_cases),
            'attempts':attempts,'errors':errors,'model_stats':model.stats(),
            'finished_utc':utc_now()})
        if errors:
            raise AssertionError(f'{engine} smoke {len(errors)} mismatches')
        print(json.dumps({'smoke':'pass','engine':engine,'cell':model.cell,
                          'attempts':attempts,'membership_rows':verified['rows']}),flush=True)
    finally:
        cleanup_engine(engine)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('command',choices=('health','prepare','block','smoke'))
    parser.add_argument('--engine',choices=('mysql','neo4j'),required=True)
    parser.add_argument('--group',choices=('main','stress','smoke-base','smoke-stress'),default='main')
    parser.add_argument('--total',type=int)
    parser.add_argument('--share',type=int)
    parser.add_argument('--cap',type=int)
    parser.add_argument('--depth',type=int,default=None)
    parser.add_argument('--round',type=int,default=0)
    parser.add_argument('--seconds-left',type=float,default=3600)
    args = parser.parse_args()
    if args.command == 'health':
        health(args.engine)
        return
    if None in (args.total,args.share,args.cap):
        parser.error('prepare/block require --total --share --cap')
    model = make_model(args)
    if args.command == 'smoke':
        smoke(model,args.engine,args.group == 'smoke-stress')
    elif args.command == 'prepare':
        prepare(model,args.engine,args.group)
    else:
        block(model,args.engine,args.round,args.seconds_left)


if __name__ == '__main__':
    main()
