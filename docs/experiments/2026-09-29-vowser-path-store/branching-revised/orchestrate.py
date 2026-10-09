"""새 20셀 코호트를 한 DB씩 재기동·warmup하며 attempt별 60분 실행."""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import time
from pathlib import Path

from branching.model import CELLS, STRESS_CELLS, cell_id
from branching import orchestrate as original
from manifest import HERE, ROOT, RESULTS, FREEZE, sha, verify, verify_cell, write_json
from rawcheck import archive_partial, block as validate_block, cell as validate_cell, combine, order

CLIENT_NAME = 'vowser-eval-v2-br3-revised'
CONTROL = ROOT/'shared/db-control.sh'
CLIENT = ROOT/'shared/run-client.sh'
ENGINES = ('mysql','neo4j')


def utc_now() -> str:
    return original.utc_now()


def command(args: list[str], log: Path, *, check: bool = True,
            timeout: float | None = None, env: dict | None = None) -> int:
    return original.command_log(args,log,check=check,timeout=timeout,env=env)


def control(action: str, engine: str, log: Path) -> None:
    command(['bash',str(CONTROL),action,engine],log,timeout=100)


def worker(action: str, engine: str, extra: list[str], log: Path, *,
           check: bool = True, timeout: float | None = None) -> int:
    env = dict(os.environ,EVAL_CLIENT_NAME='br3-revised')
    return command(['bash',str(CLIENT),'python','branching-revised/worker.py',
                    action,'--engine',engine,*extra],log,check=check,
                   timeout=timeout,env=env)


def stop_client(log: Path) -> None:
    inspect = subprocess.run(['docker','container','inspect',CLIENT_NAME],
                             stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                             check=False)
    if inspect.returncode == 0:
        command(['docker','rm','-f',CLIENT_NAME],log,timeout=30)


def stop_all(log: Path) -> None:
    for engine in ENGINES:
        control('stop',engine,log)


def activate(engine: str, log: Path) -> None:
    other = 'neo4j' if engine=='mysql' else 'mysql'
    control('stop',other,log)
    control('start',engine,log)
    control('ready',engine,log)
    deadline = time.monotonic()+90
    while True:
        try:
            healthy = worker('health',engine,[],log,check=False,timeout=40)==0
        except subprocess.TimeoutExpired:
            healthy = False
        if healthy:
            break
        if time.monotonic()>=deadline:
            raise RuntimeError(f'{engine} authenticated health not ready within 90s')
        time.sleep(2)
    states = original.active_state()
    if states != {engine:True,other:False}:
        raise AssertionError(f'one active DB contract violated: {states}')


def cell_args(args_tuple: tuple, stress: bool) -> tuple[str,list[str]]:
    if stress:
        total,depth,share,cap = args_tuple
        return cell_id(total,share,cap,depth),[
            '--total',str(total),'--share',str(share),'--cap',str(cap),'--depth',str(depth)]
    total,share,cap = args_tuple
    return cell_id(total,share,cap),[
        '--total',str(total),'--share',str(share),'--cap',str(cap)]


def previous_attempts(group: str) -> list[dict]:
    evidence = []
    for path in sorted(RESULTS.glob(f'run-{group}-*.json')):
        data = json.loads(path.read_text())
        evidence.append({'file':path.name,'sha256':sha(path),'state':data['state'],
                         'completed_cells':len(data.get('completed_cells',[]))})
    if any(item['state'] in ('running','failed','complete') for item in evidence):
        raise RuntimeError(f'previous run requires review or already complete: {evidence[-1]}')
    return evidence


def prior_consistency(group: str, attempt: str, cell: str,
                      key: str, checked: dict) -> None:
    """이미 기록된 완료 원시 SHA와 재개 시 발견한 파일을 대조한다."""
    for path in sorted(RESULTS.glob(f'run-{group}-*.json')):
        if path.name == f'run-{group}-{attempt}.json':
            continue
        prior = json.loads(path.read_text())
        recorded = (prior.get('cell_evidence',{}).get(cell) if key == 'cell'
                    else prior.get('block_evidence',{}).get(cell,{}).get(key))
        if recorded is None:
            continue
        for name in ('raw','summary'):
            if recorded[name]['sha256'] != checked[name]['sha256']:
                raise AssertionError(f'prior completed evidence changed: {cell} {key} {name} {path.name}')


def run(group: str, attempt: str) -> None:
    verify()
    previous = previous_attempts(group)
    status_path = RESULTS/f'run-{group}-{attempt}.json'
    if status_path.exists():
        raise FileExistsError(f'attempt exists: {status_path}')
    cells = STRESS_CELLS if group=='stress' else CELLS
    started = time.monotonic()
    deadline = started+3600
    status = {'cohort':'branching-revised-ordered-membership','group':group,
              'attempt':attempt,'state':'running','started_utc':utc_now(),
              'limit_seconds':3600,'freeze_sha256':sha(FREEZE),
              'previous_attempts':previous,'completed_cells':[],
              'skipped_completed_cells':[],'block_evidence':{},
              'cell_evidence':{},'input_evidence':{},'archived_partials':[],
              'expected_warmup_attempts':len(cells)*2400,
              'expected_measured_attempts':len(cells)*2400}
    write_json(status_path,status)
    host_log = RESULTS/f'host-{group}-{attempt}.log'
    try:
        signal.setitimer(signal.ITIMER_REAL,3600)
        stop_client(host_log)
        stop_all(host_log)
        for args_tuple in cells:
            if time.monotonic()>=deadline:
                raise original.TimeLimitExceeded('group reached 3600 seconds')
            cell,args = cell_args(args_tuple,group=='stress')
            folder = RESULTS/cell
            folder.mkdir(parents=True,exist_ok=True)
            status['active_cell'] = cell
            status['input_evidence'][cell] = verify_cell(cell)
            write_json(status_path,status)
            completed = validate_cell(folder)
            if completed:
                prior_consistency(group,attempt,cell,'cell',completed)
                for key,checked in completed['blocks'].items():
                    prior_consistency(group,attempt,cell,key,checked)
                status['completed_cells'].append(cell)
                status['skipped_completed_cells'].append(cell)
                status['block_evidence'][cell] = completed['blocks']
                status['cell_evidence'][cell] = {name:completed[name] for name in ('raw','summary')}
                status.pop('active_cell',None)
                write_json(status_path,status)
                print(json.dumps({'skip_complete_cell':cell}),flush=True)
                continue
            archive = RESULTS/'interrupted-attempts'/f'{group}-{attempt}'/cell
            for engine in ENGINES:
                if time.monotonic()>=deadline:
                    raise original.TimeLimitExceeded('group reached 3600 seconds')
                status['archived_partials'].extend(archive_partial(folder,
                    [f'load-{engine}.json',f'plans-{engine}.json'],archive))
                write_json(status_path,status)
                log = folder/f'prepare-{engine}-{attempt}.log'
                activate(engine,log)
                worker('prepare',engine,args,log,timeout=max(1,deadline-time.monotonic()))
                control('stop',engine,log)
                verify_cell(cell)
                print(json.dumps({'prepared':cell,'engine':engine,'attempt':attempt}),flush=True)
            blocks = {}
            for round_number in (0,1,2):
                for engine in order(round_number):
                    if time.monotonic()>=deadline:
                        raise original.TimeLimitExceeded('group reached 3600 seconds')
                    checked = validate_block(folder,engine,round_number)
                    if checked:
                        prior_consistency(group,attempt,cell,f'{engine}-r{round_number}',checked)
                        blocks[f'{engine}-r{round_number}'] = checked
                        status['block_evidence'][cell] = dict(blocks)
                        write_json(status_path,status)
                        print(json.dumps({'skip_complete_block':cell,'engine':engine,
                                          'round':round_number}),flush=True)
                        continue
                    status['archived_partials'].extend(archive_partial(folder,
                        [f'raw-{engine}-r{round_number}.csv',
                         f'block-{engine}-r{round_number}.json'],archive))
                    write_json(status_path,status)
                    log = folder/f'block-{engine}-r{round_number}-{attempt}.log'
                    activate(engine,log)
                    remaining = max(0,deadline-time.monotonic())
                    worker('block',engine,[*args,'--round',str(round_number),
                        '--seconds-left',str(remaining)],log,timeout=remaining+15)
                    control('stop',engine,log)
                    checked = validate_block(folder,engine,round_number)
                    if checked is None:
                        if time.monotonic() >= deadline:
                            raise original.TimeLimitExceeded(f'partial block at group deadline: {cell} {engine} r{round_number}')
                        raise AssertionError(f'new block incomplete before deadline: {cell} {engine} r{round_number}')
                    blocks[f'{engine}-r{round_number}'] = checked
                    status['block_evidence'][cell] = dict(blocks)
                    write_json(status_path,status)
                    print(json.dumps({'block_complete':cell,'engine':engine,
                                      'round':round_number,'attempt':attempt}),flush=True)
            status['archived_partials'].extend(archive_partial(folder,
                ['raw.csv','summary.json'],archive))
            write_json(status_path,status)
            completed = combine(folder)
            status['completed_cells'].append(cell)
            status['block_evidence'][cell] = completed['blocks']
            status['cell_evidence'][cell] = {name:completed[name] for name in ('raw','summary')}
            status.pop('active_cell',None)
            write_json(status_path,status)
            print(json.dumps({'cell_complete':cell,'attempt':attempt,
                              'elapsed_seconds':round(time.monotonic()-started,1)}),flush=True)
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
            stop_client(host_log)
        except Exception as exc:
            status['client_cleanup_error'] = str(exc)[:500]
        try:
            stop_all(host_log)
        except Exception as exc:
            status['db_cleanup_error'] = str(exc)[:500]
        status['finished_utc'] = utc_now()
        status['elapsed_seconds'] = time.monotonic()-started
        write_json(status_path,status)


def smoke(stress: bool) -> None:
    verify()
    args_tuple = (360,100,50,4) if stress else (720,50,4)
    cell,args = cell_args(args_tuple,stress)
    group = 'smoke-stress' if stress else 'smoke-base'
    folder = RESULTS/(group+'-'+cell)
    folder.mkdir(parents=True,exist_ok=True)
    status_path = folder/'host-status.json'
    if status_path.exists():
        raise FileExistsError(f'smoke already exists: {status_path}')
    status = {'group':group,'cell':cell,'state':'running','started_utc':utc_now(),
              'engines':[],'freeze_sha256':sha(FREEZE)}
    write_json(status_path,status)
    log = folder/'host.log'
    try:
        stop_client(log)
        stop_all(log)
        for engine in ENGINES:
            engine_log = folder/f'host-{engine}.log'
            activate(engine,engine_log)
            worker('smoke',engine,[*args,*(['--stress-smoke'] if stress else [])],
                   engine_log,timeout=1800)
            control('stop',engine,engine_log)
            status['engines'].append(engine)
            write_json(status_path,status)
        status['state'] = 'complete'
    except Exception as exc:
        status['state'] = 'failed'
        status['error_type'] = type(exc).__name__
        status['error'] = str(exc)[:1000]
        raise
    finally:
        try: stop_client(log)
        except Exception as exc: status['client_cleanup_error'] = str(exc)[:500]
        try: stop_all(log)
        except Exception as exc: status['db_cleanup_error'] = str(exc)[:500]
        status['finished_utc'] = utc_now()
        write_json(status_path,status)
    print(json.dumps({'smoke':'pass','group':group,'engines':status['engines']}),flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('command',choices=('smoke-base','smoke-stress','main','stress'))
    parser.add_argument('--attempt',default=None)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM,original.on_termination)
    signal.signal(signal.SIGINT,original.on_termination)
    signal.signal(signal.SIGALRM,original.on_time_limit)
    if args.command.startswith('smoke'):
        smoke(args.command=='smoke-stress')
    else:
        if not args.attempt or not args.attempt.replace('-','').replace('_','').isalnum():
            parser.error('main/stress require simple --attempt')
        run(args.command,args.attempt)


if __name__=='__main__':
    main()
