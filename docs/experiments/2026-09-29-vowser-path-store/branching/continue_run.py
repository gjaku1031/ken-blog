"""60분 중단 후 완료 블록만 보존하며 동일 고정 셀을 이어 실행.

원래 9개 실행 파일과 최초 run-status/raw는 변경하지 않는다. 이 파일은
운영상 중단 복구만 담당하며 쿼리, 사례, timeout 또는 oracle을 변경하지 않는다.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import signal
import subprocess
import time
from collections import Counter
from pathlib import Path

from branching import orchestrate as original
from branching.model import CELLS, STRESS_CELLS, digest, stable_json

ROOT = original.ROOT
RESULTS = original.RESULTS
HERE = original.HERE
ENGINES = original.ENGINES
MODES = original.MODES
RAW_FIELDS = (
    'cell','phase','round','mode','case_id','scenario','source_path','target_depth',
    'blocked_count','expected_paths','expected_rows','expected_sha256',
    'result_paths','result_rows','result_sha256','result_bytes','elapsed_ms',
    'correct','error_type','error','mismatch_codes','observed_json_if_wrong',
)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot_file(path: Path) -> dict:
    return {"file":str(path.resolve().relative_to(RESULTS.resolve())),"bytes":path.stat().st_size,
            "sha256":sha(path)}


def frozen_manifest(group: str) -> dict:
    path = RESULTS/f'preflight-{group}.json'
    manifest = json.loads(path.read_text())
    for name, expected in manifest['experiment_file_sha256'].items():
        actual = sha(HERE/name)
        if actual != expected:
            raise AssertionError(f'frozen experiment file changed: {name}')
    if sha(ROOT/'shared/data.py') != manifest['shared_data_sha256']:
        raise AssertionError('shared data changed')
    source = Path('/home/ubuntu/Develop/project/vowser/vowser-agent-server/app/services/neo4j_service.py')
    if sha(source) != manifest['source_sha256']:
        raise AssertionError('original product source changed')
    head = subprocess.check_output(['git','-C',str(source.parents[2]),'rev-parse','HEAD'],text=True).strip()
    if head != manifest['agent_server_head']:
        raise AssertionError('original product HEAD changed')
    return {"file":str(path.relative_to(RESULTS)),"sha256":sha(path),
            "source_sha256":manifest['source_sha256'],
            "shared_data_sha256":manifest['shared_data_sha256'],
            "experiment_file_sha256":manifest['experiment_file_sha256'],
            "continuation_file_sha256":{name:sha(HERE/name) for name in
                ('continue_run.py','continue_managed.sh')}}


def input_evidence(folder: Path) -> dict | None:
    path = folder/'input.json'
    if not path.exists():
        return None
    payload = json.loads(path.read_text())
    cases = payload['cases']
    if len(cases) != 200 or [case['case_id'] for case in cases] != list(range(200)):
        raise AssertionError(f'input case IDs changed: {path}')
    if digest([case['oracle_sha256'] for case in cases]) != payload['oracle_manifest_sha256']:
        raise AssertionError(f'input oracle manifest changed: {path}')
    expected_path = folder/'expected.jsonl'
    expected = [json.loads(line) for line in expected_path.read_text().splitlines()]
    if len(expected) != 200 or any(row['case_id'] != case['case_id'] or
          row['sha256'] != case['oracle_sha256'] or digest(row['rows']) != row['sha256']
          for case,row in zip(cases,expected)):
        raise AssertionError(f'expected oracle rows changed: {expected_path}')
    return {"sha256":sha(path),"oracle_manifest_sha256":payload['oracle_manifest_sha256'],
            "cases":len(cases),"expected_jsonl_sha256":sha(expected_path)}


def read_rows(path: Path) -> list[dict]:
    with path.open(newline='') as stream:
        reader = csv.DictReader(stream,strict=True)
        if tuple(reader.fieldnames or ()) != RAW_FIELDS:
            # The original runner writes branching.bench.RAW_FIELDS.
            raise AssertionError(f'wrong CSV header: {path}')
        return list(reader)


def expected_block_modes(engine: str) -> tuple[str,str]:
    return ('mysql_adj','mysql_member') if engine == 'mysql' else ('neo_adj','neo_member')


def validate_block(folder: Path, engine: str, round_number: int, cell: str) -> dict | None:
    summary_path = folder/f'block-{engine}-r{round_number}.json'
    raw_path = folder/f'raw-{engine}-r{round_number}.csv'
    if not summary_path.exists():
        return None
    summary = json.loads(summary_path.read_text())
    if not summary.get('complete'):
        return None
    if not raw_path.exists():
        raise AssertionError(f'block marked complete but raw missing: {raw_path}')
    rows = read_rows(raw_path)
    if len(rows) != 800:
        raise AssertionError(f'block marked complete but raw count !=800: {raw_path}')
    expected = Counter((phase,mode,case_id) for phase in ('warmup','measure')
                       for mode in expected_block_modes(engine) for case_id in range(200))
    actual = Counter((r['phase'],r['mode'],int(r['case_id'])) for r in rows)
    if actual != expected or any(r['cell'] != cell or int(r['round']) != round_number for r in rows):
        raise AssertionError(f'block marked complete but case coverage differs: {raw_path}')
    cases = json.loads((folder/'input.json').read_text())['cases']
    expected_rows = [json.loads(line) for line in (folder/'expected.jsonl').read_text().splitlines()]
    for row in rows:
        case = cases[int(row['case_id'])]
        oracle = expected_rows[int(row['case_id'])]
        if row['expected_sha256'] != case['oracle_sha256'] or row['expected_sha256'] != oracle['sha256']:
            raise AssertionError(f'block oracle SHA differs: {raw_path} case {row["case_id"]}')
        if row['correct'] not in ('True','False'):
            raise AssertionError(f'block correct flag malformed: {raw_path} case {row["case_id"]}')
        if row['correct'] == 'True':
            expected_bytes = len(stable_json(oracle['rows']))
            if (row['result_sha256'] != row['expected_sha256'] or row['error_type'] or row['error'] or
                int(row['result_rows']) != int(case['oracle_rows']) or
                int(row['result_paths']) != int(case['oracle_paths']) or
                int(row['result_bytes']) != expected_bytes):
                raise AssertionError(f'block true-result payload metadata differs: {raw_path} case {row["case_id"]}')
    return {"raw":snapshot_file(raw_path),"summary":snapshot_file(summary_path),
            "attempts":800,"measured_attempts":400,
            "observed_correct":sum(r['correct']=='True' for r in rows)}


def validate_cell(folder: Path, cell: str) -> dict | None:
    combined = folder/'raw.csv'
    summary_path = folder/'summary.json'
    if not summary_path.exists():
        return None
    summary = json.loads(summary_path.read_text())
    if not summary.get('complete'):
        return None
    if not combined.exists():
        raise AssertionError(f'cell marked complete but combined raw missing: {combined}')
    blocks = {}
    for round_number in (0,1,2):
        for engine in (ENGINES if round_number % 2 == 0 else ENGINES[::-1]):
            block = validate_block(folder,engine,round_number,cell)
            if block is None:
                raise AssertionError(f'cell marked complete but block incomplete: {cell} {engine} r{round_number}')
            blocks[f'{engine}-r{round_number}'] = block
    rows = read_rows(combined)
    if len(rows) != 4800:
        raise AssertionError(f'cell marked complete but raw count !=4800: {combined}')
    if Counter((r['phase'],r['mode'],int(r['round']),int(r['case_id'])) for r in rows) != Counter(
        (phase,mode,round_number,case_id) for phase in ('warmup','measure') for mode in MODES
        for round_number in (0,1,2) for case_id in range(200)):
        raise AssertionError(f'cell marked complete but case coverage differs: {combined}')
    block_rows = []
    for round_number in (0,1,2):
        for engine in (ENGINES if round_number % 2 == 0 else ENGINES[::-1]):
            block_rows.extend(read_rows(folder/f'raw-{engine}-r{round_number}.csv'))
    if rows != block_rows:
        raise AssertionError(f'combined raw differs from six completed blocks: {combined}')
    return {"raw":snapshot_file(combined),"summary":snapshot_file(summary_path),"blocks":blocks}


def archive_partial(folder: Path, names: list[str], archive: Path) -> list[dict]:
    archive.mkdir(parents=True,exist_ok=True)
    saved = []
    for name in names:
        source = folder/name
        if not source.exists():
            continue
        target = archive/name
        if target.exists():
            raise AssertionError(f'archive already exists: {target}')
        evidence = snapshot_file(source)
        source.rename(target)
        evidence['archive'] = str(target.relative_to(RESULTS))
        # 부분 CSV는 실제 발행 시도 수가 아닌 보존된 행의 하한만 기록한다.
        if name.endswith('.csv'):
            parsed = 0
            try:
                with target.open(newline='') as stream:
                    for _ in csv.DictReader(stream,strict=True):
                        parsed += 1
                if target.stat().st_size and not target.read_bytes().endswith(b'\n'):
                    parsed = max(0,parsed-1)
                evidence['parse_error'] = None
            except Exception as exc:
                evidence['parse_error'] = f'{type(exc).__name__}: {exc}'[:500]
            evidence['parseable_rows_lower_bound'] = parsed
        saved.append(evidence)
    return saved


def require_previous_stopped(group: str) -> dict:
    path = RESULTS/('stress-run-status.json' if group == 'stress' else 'run-status.json')
    previous = json.loads(path.read_text())
    if previous['state'] not in ('time_limit_incomplete','interrupted'):
        raise AssertionError(f'original run is not an interrupted attempt: {previous["state"]}')
    return {"status":snapshot_file(path),"state":previous['state'],
            "completed_cells":previous['completed_cells'],"partial_cell":previous.get('partial_cell')}


def run(group: str, attempt: str) -> None:
    if not attempt.isascii() or not attempt.replace('-','').replace('_','').isalnum():
        raise ValueError('attempt must be simple ASCII letters/digits/-/_')
    status_path = RESULTS/f'continuation-{group}-{attempt}.json'
    if status_path.exists():
        raise RuntimeError(f'continuation status already exists: {status_path}')
    first = require_previous_stopped(group)
    frozen = frozen_manifest(group)
    cells = STRESS_CELLS if group == 'stress' else CELLS
    started = time.monotonic()
    deadline = started+3600
    status = {"state":"running","group":group,"attempt":attempt,
              "started_utc":original.utc_now(),"limit_seconds":3600,
              "first_attempt":first,"frozen":frozen,"completed_cells":[],
              "skipped_completed_cells":[],"archived_partials":[],
              "input_evidence":{},"block_evidence":{}}
    original.write_json(status_path,status)
    log = RESULTS/f'continuation-{group}-{attempt}.log'
    try:
        signal.setitimer(signal.ITIMER_REAL,3600)
        original.stop_client(log)
        original.stop_all(log)
        for args_tuple in cells:
            if time.monotonic() >= deadline:
                raise original.TimeLimitExceeded('continuation group reached 3600 s')
            cell,args = original.cell_args(args_tuple,group=='stress')
            folder = RESULTS/cell
            status['active_cell'] = cell
            original.write_json(status_path,status)
            existing = validate_cell(folder,cell)
            if existing:
                status['completed_cells'].append(cell)
                status['skipped_completed_cells'].append(cell)
                status['input_evidence'][cell] = input_evidence(folder)
                status['block_evidence'][cell] = existing['blocks']
                original.write_json(status_path,status)
                print(json.dumps({"skip_complete_cell":cell}),flush=True)
                continue
            before_input = input_evidence(folder)
            status['input_evidence'][cell] = {"before_reload":before_input}
            original.write_json(status_path,status)
            # 중단된 셀도 두 DB의 결정적 fixture를 다시 검증·적재한다.
            for engine in ENGINES:
                if time.monotonic() >= deadline:
                    raise original.TimeLimitExceeded('continuation group reached 3600 s')
                archived = archive_partial(folder,[f'load-{engine}.json',f'plans-{engine}.json'],
                    RESULTS/'interrupted-attempts'/f'{group}-{attempt}'/cell)
                status['archived_partials'].extend(archived)
                original.write_json(status_path,status)
                engine_log = folder/f'continuation-prepare-{engine}-{attempt}.log'
                original.activate(engine,engine_log)
                original.worker('prepare',engine,['--group',group,*args],engine_log,
                    timeout=max(1,deadline-time.monotonic()))
                original.control('stop',engine,engine_log)
                print(json.dumps({"prepared":cell,"engine":engine,"attempt":attempt}),flush=True)
            after_input = input_evidence(folder)
            if before_input is not None and after_input != before_input:
                raise AssertionError(f'input/oracle SHA changed on fixture reload: {cell}')
            status['input_evidence'][cell] = {"before_reload":before_input,
                                              "after_reload":after_input}
            original.write_json(status_path,status)
            blocks = {}
            for round_number in (0,1,2):
                order = ENGINES if round_number % 2 == 0 else ENGINES[::-1]
                for engine in order:
                    if time.monotonic() >= deadline:
                        raise original.TimeLimitExceeded('continuation group reached 3600 s')
                    complete = validate_block(folder,engine,round_number,cell)
                    if complete:
                        blocks[f'{engine}-r{round_number}'] = complete
                        status['block_evidence'][cell] = dict(blocks)
                        original.write_json(status_path,status)
                        print(json.dumps({"skip_complete_block":cell,"engine":engine,
                                          "round":round_number}),flush=True)
                        continue
                    names = [f'raw-{engine}-r{round_number}.csv',
                             f'block-{engine}-r{round_number}.json']
                    archived = archive_partial(folder,names,
                        RESULTS/'interrupted-attempts'/f'{group}-{attempt}'/cell)
                    status['archived_partials'].extend(archived)
                    original.write_json(status_path,status)
                    engine_log = folder/f'continuation-block-{engine}-r{round_number}-{attempt}.log'
                    original.activate(engine,engine_log)
                    remaining = max(0,deadline-time.monotonic())
                    original.worker('block',engine,['--group',group,*args,
                        '--round',str(round_number),'--seconds-left',str(remaining)],
                        engine_log,timeout=remaining+15)
                    original.control('stop',engine,engine_log)
                    complete = validate_block(folder,engine,round_number,cell)
                    if complete is None:
                        raise AssertionError(f'new block incomplete: {cell} {engine} r{round_number}')
                    blocks[f'{engine}-r{round_number}'] = complete
                    status['block_evidence'][cell] = dict(blocks)
                    original.write_json(status_path,status)
                    print(json.dumps({"block_complete":cell,"engine":engine,
                                      "round":round_number,"attempt":attempt}),flush=True)
            status['block_evidence'][cell] = blocks
            archived = archive_partial(folder,['raw.csv','summary.json'],
                RESULTS/'interrupted-attempts'/f'{group}-{attempt}'/cell)
            status['archived_partials'].extend(archived)
            original.write_json(status_path,status)
            original.combine_raw(cell)
            complete_cell = validate_cell(folder,cell)
            if complete_cell is None:
                raise AssertionError(f'combined cell incomplete: {cell}')
            status['completed_cells'].append(cell)
            status.pop('active_cell',None)
            original.write_json(status_path,status)
            print(json.dumps({"cell_complete":cell,"attempt":attempt,
                              "elapsed_seconds":round(time.monotonic()-started,1)}),flush=True)
        status['state'] = 'complete'
    except (original.TimeLimitExceeded,subprocess.TimeoutExpired) as exc:
        status['state'] = 'time_limit_incomplete'
        status['error_type'] = type(exc).__name__
        status['error'] = str(exc)[:1000]
        status['partial_cell'] = status.get('active_cell')
    except original.InterruptedRun as exc:
        status['state'] = 'interrupted'
        status['error_type'] = type(exc).__name__
        status['error'] = str(exc)
        status['partial_cell'] = status.get('active_cell')
        raise
    except Exception as exc:
        status['state'] = 'failed'
        status['error_type'] = type(exc).__name__
        status['error'] = str(exc)[:1000]
        status['partial_cell'] = status.get('active_cell')
        raise
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        try:
            original.stop_client(log)
        except Exception as exc:
            status['client_cleanup_error'] = str(exc)[:500]
        try:
            original.stop_all(log)
        except Exception as exc:
            status['db_cleanup_error'] = str(exc)[:500]
        status['finished_utc'] = original.utc_now()
        status['elapsed_seconds'] = time.monotonic()-started
        original.write_json(status_path,status)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('group',choices=('main','stress'))
    parser.add_argument('--attempt',required=True)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM,original.on_termination)
    signal.signal(signal.SIGINT,original.on_termination)
    signal.signal(signal.SIGALRM,original.on_time_limit)
    run(args.group,args.attempt)


if __name__ == '__main__':
    main()
