"""측정 종료 후 동결 원시자료만 읽어 집계하는 독립 후처리."""

from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path

from branching.model import CELLS, STRESS_CELLS, cell_id
from manifest import RESULTS, sha, verify, write_json
from rawcheck import MODES, cell as validate_cell


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    data = sorted(values)
    position = (len(data)-1)*fraction
    low, high = math.floor(position), math.ceil(position)
    return round(data[low]+(data[high]-data[low])*(position-low),3)


def timeout(row: dict) -> bool:
    value = (row['error_type']+' '+row['error']).lower()
    return any(term in value for term in (
        'timeout','timedout','timed out','maximum statement execution time',
        'exceeded the configured timeout',
    ))


def describe(rows: list[dict]) -> dict:
    passed = [row for row in rows if row['correct']=='True']
    latencies = [float(row['elapsed_ms']) for row in passed]
    return {
        'attempts':len(rows),'correct':len(passed),
        'timeouts':sum(timeout(row) for row in rows),
        'wrong_results':sum(row['error_type']=='WrongResult' for row in rows),
        'other_errors':sum(row['correct']!='True' and not timeout(row) and
                           row['error_type']!='WrongResult' for row in rows),
        'p50_ms_correct':percentile(latencies,0.5),
        'p95_ms_correct':percentile(latencies,0.95),
        'error_types':dict(Counter(row['error_type'] for row in rows if row['correct']!='True')),
        'mean_result_bytes_correct':round(sum(int(row['result_bytes']) for row in passed)/len(passed),1) if passed else None,
    }


def read_rows(path: Path) -> list[dict]:
    with path.open(newline='') as file:
        return list(csv.DictReader(file,strict=True))


def cells() -> dict[str,list[str]]:
    return {
        'main':[cell_id(*args) for args in CELLS],
        'stress':[cell_id(total,share,cap,depth) for total,depth,share,cap in STRESS_CELLS],
    }


def analyze() -> dict:
    verify()
    groups = cells()
    result = {'cohort':'branching-revised-ordered-membership',
              'freeze_sha256':sha(RESULTS/'freeze.json'),
              'input_freeze_sha256':sha(RESULTS/'input-freeze.json'),
              'groups':{},'cells':{},'attempts':{}}
    for group,items in groups.items():
        gathered = []
        for name in items:
            folder = RESULTS/name
            evidence = validate_cell(folder)
            if evidence is None:
                raise AssertionError(f'cohort incomplete: {name}')
            raw = read_rows(folder/'raw.csv')
            if len(raw)!=4800:
                raise AssertionError(f'cell raw count changed: {name}')
            input_data = json.loads((folder/'input.json').read_text())
            measured = [row for row in raw if row['phase']=='measure']
            warmup = [row for row in raw if row['phase']=='warmup']
            result['cells'][name] = {
                'group':group,'raw_sha256':evidence['raw']['sha256'],
                'stats':input_data['stats'],
                'measured':{mode:describe([row for row in measured if row['mode']==mode]) for mode in MODES},
                'warmup':{mode:describe([row for row in warmup if row['mode']==mode]) for mode in MODES},
                'target_depth':{mode:{depth:describe([row for row in measured if row['mode']==mode
                    and row['scenario']=='alternate' and row['target_depth']==str(depth)])
                    for depth in (5,10,20)} for mode in MODES} if group=='main' else {},
                'scenario':{mode:{scenario:describe([row for row in measured if row['mode']==mode
                    and row['scenario']==scenario]) for scenario in ('alternate','none','auth')}
                    for mode in MODES},
            }
            gathered.extend(raw)
        by_phase = {phase:{mode:describe([row for row in gathered if row['phase']==phase
                                  and row['mode']==mode]) for mode in MODES}
                    for phase in ('measure','warmup')}
        result['groups'][group] = {'cells':items,'cell_count':len(items),
                                   'raw_attempts':len(gathered),'mode':by_phase,
                                   'scenario':{mode:{scenario:describe([row for row in gathered
                                       if row['phase']=='measure' and row['mode']==mode
                                       and row['scenario']==scenario])
                                       for scenario in ('alternate','none','auth')}
                                       for mode in MODES},
                                   'target_depth':{mode:{str(depth):describe([row for row in gathered
                                       if row['phase']=='measure' and row['mode']==mode
                                       and row['scenario']=='alternate'
                                       and row['target_depth']==str(depth)])
                                       for depth in (5,10,20)} for mode in MODES}
                                       if group=='main' else {}}
        statuses = []
        for path in sorted(RESULTS.glob(f'run-{group}-*.json')):
            data = json.loads(path.read_text())
            statuses.append({'file':path.name,'sha256':sha(path),'state':data['state'],
                             'completed_cells':len(data.get('completed_cells',[])),
                             'skipped_completed_cells':len(data.get('skipped_completed_cells',[])),
                             'partial_cell':data.get('partial_cell'),
                             'archived_partials':data.get('archived_partials',[]),
                             'started_utc':data.get('started_utc'),
                             'finished_utc':data.get('finished_utc'),
                             'elapsed_seconds':data.get('elapsed_seconds')})
        result['attempts'][group] = statuses
    return result


if __name__=='__main__':
    summary = analyze()
    write_json(RESULTS/'analysis.json',summary)
    print(json.dumps({'main_cells':summary['groups']['main']['cell_count'],
                      'stress_cells':summary['groups']['stress']['cell_count'],
                      'analysis_sha256':sha(RESULTS/'analysis.json')}))
