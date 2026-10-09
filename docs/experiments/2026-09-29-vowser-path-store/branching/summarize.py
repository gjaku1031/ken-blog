"""보존된 raw.csv만으로 성공률·지연을 재계산."""

from __future__ import annotations

import csv
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from branching.model import CELLS, STRESS_CELLS, cell_id

HERE = Path(__file__).resolve().parent
RESULTS = HERE/'results'
MODES = ('neo_adj','mysql_adj','neo_member','mysql_member')


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    data = sorted(values)
    position = (len(data)-1)*fraction
    lo,hi = math.floor(position),math.ceil(position)
    return round(data[lo]+(data[hi]-data[lo])*(position-lo),3)


def is_timeout(row: dict) -> bool:
    value = (row['error_type']+' '+row['error']).lower()
    return any(term in value for term in ('timeout','timed out','maximum statement execution time','exceeded the configured timeout'))


def describe(rows: list[dict]) -> dict:
    passed = [r for r in rows if r['correct']=='True']
    latencies = [float(r['elapsed_ms']) for r in passed]
    return {
        'attempts':len(rows),'correct':len(passed),'correct_rate':len(passed)/len(rows) if rows else None,
        'timeouts':sum(is_timeout(r) for r in rows),
        'wrong_results':sum(r['error_type']=='WrongResult' for r in rows),
        'other_errors':sum(not is_timeout(r) and r['error_type'] not in ('','WrongResult') for r in rows),
        'p50_ms_correct':percentile(latencies,0.5),
        'p95_ms_correct':percentile(latencies,0.95),
        'mean_result_bytes_correct':round(sum(int(r['result_bytes']) for r in passed)/len(passed),1) if passed else None,
        'mean_result_steps_correct':round(sum(int(r['result_rows']) for r in passed)/len(passed),2) if passed else None,
        'error_types':dict(Counter(r['error_type'] for r in rows if r['error_type'])),
        'mismatch_codes':dict(Counter(code for r in rows for code in r.get('mismatch_codes','').split(',') if code)),
    }


def analyze_cell(cell: str) -> dict:
    folder = RESULTS/cell
    input_data = json.loads((folder/'input.json').read_text())
    sources = [folder/'raw.csv'] if (folder/'raw.csv').exists() else sorted(folder.glob('raw-*-r*.csv'))
    raw = []
    for source in sources:
        with source.open(newline='') as file:
            raw.extend(csv.DictReader(file))
    rows = [r for r in raw if r['phase']=='measure']
    by_mode = {mode:describe([r for r in rows if r['mode']==mode]) for mode in MODES}
    by_scenario = {mode:{scenario:describe([r for r in rows if r['mode']==mode and r['scenario']==scenario])
                         for scenario in sorted({r['scenario'] for r in rows})}
                   for mode in MODES}
    by_depth = {mode:{depth:describe([r for r in rows if r['mode']==mode and r['scenario']=='alternate'
                                     and r['target_depth']==depth])
                      for depth in sorted({r['target_depth'] for r in rows if r['target_depth']})}
                for mode in MODES}
    by_round = {mode:{str(n):describe([r for r in rows if r['mode']==mode and int(r['round'])==n])
                      for n in (0,1,2)} for mode in MODES}
    return {'cell':cell,'model_stats':input_data['stats'],'mode':by_mode,
            'scenario':by_scenario,'target_depth':by_depth,'round':by_round,
            'raw_rows':len(raw),'measured_rows':len(rows),
            'raw_sources':[p.name for p in sources],
            'complete':all(value['attempts']==600 for value in by_mode.values())}


def main() -> None:
    cells = [cell_id(*args) for args in CELLS]
    stress = [cell_id(total,share,cap,depth) for total,depth,share,cap in STRESS_CELLS]
    available = [cell for cell in cells+stress if (RESULTS/cell/'raw.csv').exists()
                 or list((RESULTS/cell).glob('raw-*-r*.csv'))]
    summary = {'main_cells':cells,'stress_cells':stress,
               'available_cells':available,
               'cells':{cell:analyze_cell(cell) for cell in available}}
    (RESULTS/'analysis.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'available':len(available),'main_complete':sum(summary['cells'][c]['complete'] for c in cells if c in summary['cells']),
                      'stress_complete':sum(summary['cells'][c]['complete'] for c in stress if c in summary['cells'])}))


if __name__=='__main__':
    main()
