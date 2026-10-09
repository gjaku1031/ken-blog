"""호스트에서 DB 하나씩 기동하며 조건별 backend·round 블록 교차."""

from __future__ import annotations

import argparse
import csv
import json
import os
import signal
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from branching.model import CELLS, STRESS_CELLS, cell_id

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RESULTS = HERE/'results'
CONTROL = ROOT/'shared/db-control.sh'
CLIENT = ROOT/'shared/run-client.sh'
ENGINES = ('mysql','neo4j')
MODES = ('neo_adj','mysql_adj','neo_member','mysql_member')
CLIENT_NAME = 'vowser-eval-v2-br3'


class InterruptedRun(Exception):
    pass


class TimeLimitExceeded(Exception):
    pass


def on_termination(signum, _frame):
    raise InterruptedRun(f'received signal {signum}')


def on_time_limit(_signum, _frame):
    raise TimeLimitExceeded('group wall clock reached 3600 s')


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,sort_keys=True)+'\n')


def command_log(args: list[str], log: Path, *, check: bool = True,
                timeout: float | None = None, env: dict | None = None) -> int:
    log.parent.mkdir(parents=True,exist_ok=True)
    with log.open('a') as file:
        file.write(f'[{utc_now()}] command: {" ".join(args)}\n')
        file.flush()
        process = subprocess.Popen(args,cwd=ROOT,stdout=file,stderr=subprocess.STDOUT,
                                   text=True,env=env)
        try:
            code = process.wait(timeout=timeout)
        except BaseException:
            if process.poll() is None:
                try:
                    process.terminate()
                except ProcessLookupError:
                    pass
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            raise
        file.write(f'[{utc_now()}] exit={code}\n')
    if check and code:
        raise RuntimeError(f'command failed ({code}); see {log}')
    return code


def control(action: str, engine: str, log: Path) -> None:
    command_log(['bash',str(CONTROL),action,engine],log,timeout=100)


def worker(command: str, engine: str, args: list[str], log: Path, *,
           check: bool = True, timeout: float | None = None) -> int:
    env = dict(os.environ,EVAL_CLIENT_NAME='br3')
    return command_log(['bash',str(CLIENT),'python','-m','branching.worker',command,
                        '--engine',engine,*args],log,check=check,timeout=timeout,env=env)


def stop_client(log: Path) -> None:
    inspect = subprocess.run(['docker','container','inspect',CLIENT_NAME],
                             stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                             check=False)
    if inspect.returncode == 0:
        command_log(['docker','rm','-f',CLIENT_NAME],log,timeout=30)


def active_state() -> dict[str,bool]:
    result = {}
    for engine in ENGINES:
        name = 'vowser-eval-v2-mysql' if engine == 'mysql' else 'vowser-eval-v2-neo4j'
        state = subprocess.check_output(['docker','inspect','--format','{{.State.Running}}',name],text=True).strip()
        result[engine] = state == 'true'
    return result


def activate(engine: str, log: Path) -> None:
    other = 'neo4j' if engine == 'mysql' else 'mysql'
    control('stop',other,log)
    control('start',engine,log)
    control('ready',engine,log)
    deadline = time.monotonic()+90
    while True:
        try:
            healthy = worker('health',engine,[],log,check=False,timeout=15) == 0
        except subprocess.TimeoutExpired:
            healthy = False
        if healthy:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError(f'{engine} authenticated health not ready within 90 s; see {log}')
        time.sleep(2)
    states = active_state()
    if states != {engine:True,other:False}:
        raise AssertionError(f'one active DB contract violated: {states}')


def stop_all(log: Path) -> None:
    for engine in ENGINES:
        control('stop',engine,log)


def cell_args(cell_tuple: tuple, stress: bool) -> tuple[str,list[str]]:
    if stress:
        total,depth,share,cap = cell_tuple
        cell = cell_id(total,share,cap,depth)
        args = ['--total',str(total),'--share',str(share),'--cap',str(cap),'--depth',str(depth)]
    else:
        total,share,cap = cell_tuple
        cell = cell_id(total,share,cap)
        args = ['--total',str(total),'--share',str(share),'--cap',str(cap)]
    return cell,args


def combine_raw(cell: str) -> dict:
    folder = RESULTS/cell
    blocks = [(round_number,engine) for round_number in (0,1,2)
              for engine in (('mysql','neo4j') if round_number % 2 == 0 else ('neo4j','mysql'))]
    total = 0
    phase_counts = {}
    with (folder/'raw.csv').open('x',newline='') as output:
        writer = None
        for round_number,engine in blocks:
            source = folder/f'raw-{engine}-r{round_number}.csv'
            with source.open(newline='') as file:
                reader = csv.DictReader(file)
                if writer is None:
                    writer = csv.DictWriter(output,fieldnames=reader.fieldnames)
                    writer.writeheader()
                elif reader.fieldnames != writer.fieldnames:
                    raise AssertionError('raw field mismatch across blocks')
                for row in reader:
                    writer.writerow(row)
                    total += 1
                    key = f"{row['phase']}:{row['mode']}"
                    phase_counts[key] = phase_counts.get(key,0)+1
    complete = total == 4800 and all(phase_counts.get(f'{phase}:{mode}',0)==600
        for phase in ('warmup','measure') for mode in MODES)
    summary = {'cell':cell,'raw_attempts':total,'phase_mode_counts':phase_counts,
               'complete':complete,'combined_utc':utc_now()}
    write_json(folder/'summary.json',summary)
    if not complete:
        raise AssertionError(f'cell {cell} incomplete raw: {summary}')
    return summary


def run(stress: bool) -> None:
    RESULTS.mkdir(parents=True,exist_ok=True)
    status_path = RESULTS/('stress-run-status.json' if stress else 'run-status.json')
    if status_path.exists():
        raise RuntimeError(f'existing status must be archived before rerun: {status_path}')
    group = 'stress' if stress else 'main'
    cells = STRESS_CELLS if stress else CELLS
    started = time.monotonic()
    deadline = started+3600
    status = {'group':group,'state':'running','started_utc':utc_now(),
              'limit_seconds':3600,'completed_cells':[],
              'expected_warmup_attempts':len(cells)*2400,
              'expected_measured_attempts':len(cells)*2400,
              'expected_total_attempts':len(cells)*4800,
              'one_active_database':True}
    write_json(status_path,status)
    global_log = RESULTS/f'host-{group}.log'
    try:
        signal.setitimer(signal.ITIMER_REAL,3600)
        stop_client(global_log)
        stop_all(global_log)
        for cell_tuple in cells:
            if time.monotonic() >= deadline:
                status['state'] = 'time_limit_incomplete'
                break
            cell,args = cell_args(cell_tuple,stress)
            status['active_cell'] = cell
            write_json(status_path,status)
            folder = RESULTS/cell
            folder.mkdir(parents=True,exist_ok=True)
            for engine in ENGINES:
                if time.monotonic() >= deadline:
                    status['state'] = 'time_limit_incomplete'
                    break
                log = folder/f'prepare-{engine}.log'
                activate(engine,log)
                worker('prepare',engine,['--group',group,*args],log,
                       timeout=max(1,deadline-time.monotonic()))
                control('stop',engine,log)
                print(json.dumps({'prepared':cell,'engine':engine}),flush=True)
            if status['state'] != 'running':
                break
            for round_number in (0,1,2):
                order = ENGINES if round_number % 2 == 0 else ENGINES[::-1]
                for engine in order:
                    if time.monotonic() >= deadline:
                        status['state'] = 'time_limit_incomplete'
                        break
                    log = folder/f'block-{engine}-r{round_number}.log'
                    activate(engine,log)
                    remaining = max(0,deadline-time.monotonic())
                    worker('block',engine,['--group',group,*args,'--round',str(round_number),
                                           '--seconds-left',str(remaining)],log,
                           timeout=remaining+15)
                    control('stop',engine,log)
                    block_summary = json.loads((folder/f'block-{engine}-r{round_number}.json').read_text())
                    print(json.dumps({'cell':cell,'round':round_number,'engine':engine,
                                      'complete':block_summary['complete']}),flush=True)
                    if not block_summary['complete']:
                        status['state'] = 'time_limit_incomplete'
                        break
                if status['state'] != 'running':
                    break
            if status['state'] != 'running':
                status['partial_cell'] = cell
                break
            combine_raw(cell)
            status['completed_cells'].append(cell)
            status.pop('active_cell',None)
            write_json(status_path,status)
            print(json.dumps({'cell_complete':cell,'elapsed_seconds':round(time.monotonic()-started,1)}),flush=True)
        if status['state'] == 'running':
            status['state'] = 'complete'
    except subprocess.TimeoutExpired as exc:
        status['state'] = 'time_limit_incomplete'
        status['error_type'] = 'HostTimeoutExpired'
        status['error'] = str(exc)[:1000]
        status['partial_cell'] = status.get('active_cell')
    except TimeLimitExceeded as exc:
        status['state'] = 'time_limit_incomplete'
        status['error_type'] = type(exc).__name__
        status['error'] = str(exc)
        status['partial_cell'] = status.get('active_cell')
    except InterruptedRun as exc:
        status['state'] = 'interrupted'
        status['error_type'] = type(exc).__name__
        status['error'] = str(exc)
        status['partial_cell'] = status.get('active_cell')
        raise
    except Exception as exc:
        status['state'] = 'failed'
        status['error_type'] = type(exc).__name__
        status['error'] = str(exc)[:1000]
        raise
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        try:
            stop_client(global_log)
        except Exception as exc:
            status['client_cleanup_error'] = str(exc)[:500]
        try:
            stop_all(global_log)
        except Exception as exc:
            status['cleanup_error'] = str(exc)[:500]
        status['finished_utc'] = utc_now()
        status['elapsed_seconds'] = time.monotonic()-started
        write_json(status_path,status)


def run_smoke(stress: bool) -> None:
    group = 'smoke-stress' if stress else 'smoke-base'
    cell_tuple = (360,100,50,4) if stress else (720,50,4)
    cell,args = cell_args(cell_tuple,stress)
    folder = RESULTS/(('smoke-stress-' if stress else 'smoke-v2-')+cell)
    folder.mkdir(parents=True,exist_ok=True)
    status_path = folder/'host-status.json'
    if status_path.exists():
        raise RuntimeError(f'existing smoke status must be archived: {status_path}')
    status = {'group':group,'cell':cell,'state':'running','started_utc':utc_now(),
              'one_active_database':True,'engines':[]}
    write_json(status_path,status)
    log = folder/'host.log'
    try:
        stop_client(log)
        stop_all(log)
        for engine in ENGINES:
            engine_log = folder/f'host-{engine}.log'
            activate(engine,engine_log)
            worker('smoke',engine,['--group',group,*args],engine_log,timeout=1800)
            control('stop',engine,engine_log)
            status['engines'].append(engine)
            write_json(status_path,status)
        status['state'] = 'complete'
    except InterruptedRun as exc:
        status['state'] = 'interrupted'
        status['error_type'] = type(exc).__name__
        status['error'] = str(exc)
        raise
    except Exception as exc:
        status['state'] = 'failed'
        status['error_type'] = type(exc).__name__
        status['error'] = str(exc)[:1000]
        raise
    finally:
        try:
            stop_client(log)
        except Exception as exc:
            status['client_cleanup_error'] = str(exc)[:500]
        try:
            stop_all(log)
        except Exception as exc:
            status['cleanup_error'] = str(exc)[:500]
        status['finished_utc'] = utc_now()
        write_json(status_path,status)
    print(json.dumps({'smoke':'pass','group':group,'engines':status['engines']}),flush=True)


def main() -> None:
    signal.signal(signal.SIGTERM,on_termination)
    signal.signal(signal.SIGINT,on_termination)
    signal.signal(signal.SIGALRM,on_time_limit)
    parser = argparse.ArgumentParser()
    parser.add_argument('group',choices=('main','stress','smoke','smoke-stress'))
    args = parser.parse_args()
    if args.group in ('smoke','smoke-stress'):
        run_smoke(stress=args.group=='smoke-stress')
    else:
        run(stress=args.group=='stress')


if __name__ == '__main__':
    main()
