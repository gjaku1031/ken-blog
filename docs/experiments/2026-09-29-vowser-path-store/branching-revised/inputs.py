"""새 20셀의 입력·전체 정답을 DB 실행 전에 결정적으로 생성·고정."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from branching.model import CELLS, STRESS_CELLS, Model, digest, stable_json
from manifest import HERE, ROOT, RESULTS, INPUT_FREEZE, sha, write_json


def cell_rows():
    for total,share,cap in CELLS:
        yield 'main',(total,share,cap,None)
    for total,depth,share,cap in STRESS_CELLS:
        yield 'stress',(total,share,cap,depth)


def ensure_bytes(path, payload: bytes) -> None:
    if path.exists():
        if path.read_bytes() != payload:
            raise AssertionError(f'existing frozen input differs: {path}')
    else:
        with path.open('xb') as file:
            file.write(payload)


def main() -> None:
    if INPUT_FREEZE.exists():
        raise FileExistsError('input-freeze already exists; do not regenerate in place')
    records = {}
    for group,args in cell_rows():
        model = Model(args[0],args[1],args[2],depth_override=args[3])
        out = RESULTS/model.cell
        out.mkdir(parents=True,exist_ok=True)
        cases = model.cases()
        if len(cases) != 200:
            raise AssertionError('each cell must contain exactly 200 fixed cases')
        input_data = {'cell':model.cell,'seed':20260929,'stats':model.stats(),
                      'cases':cases,'oracle_manifest_sha256':digest([c['oracle_sha256'] for c in cases])}
        input_bytes = (json.dumps(input_data,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode()
        expected_bytes = b''.join(stable_json({'case_id':case['case_id'],
            'rows':model.oracle(case),'sha256':case['oracle_sha256']})+b'\n' for case in cases)
        ensure_bytes(out/'input.json',input_bytes)
        ensure_bytes(out/'expected.jsonl',expected_bytes)
        old = ROOT/'branching/results'/model.cell
        old_presence = (old/'input.json').exists()
        if old_presence:
            if (old/'input.json').read_bytes() != input_bytes or (old/'expected.jsonl').read_bytes() != expected_bytes:
                raise AssertionError(f'original input/oracle differs: {model.cell}')
        records[model.cell] = {
            'group':group,'arguments':args,'total_paths':model.total,
            'input.json':{'sha256':sha(out/'input.json'),'bytes':len(input_bytes)},
            'expected.jsonl':{'sha256':sha(out/'expected.jsonl'),'bytes':len(expected_bytes)},
            'oracle_manifest_sha256':input_data['oracle_manifest_sha256'],
            'original_input_present':old_presence,
            'original_input_sha256':sha(old/'input.json') if old_presence else None,
            'original_expected_sha256':sha(old/'expected.jsonl') if old_presence else None,
        }
        print(json.dumps({'cell':model.cell,'group':group,'original_equal':old_presence}),flush=True)
    data = {'created_utc':datetime.now(timezone.utc).isoformat(),
            'seed':20260929,'main_cells':len(CELLS),'stress_cells':len(STRESS_CELLS),
            'cells':records}
    write_json(INPUT_FREEZE,data)
    print(json.dumps({'input_freeze':str(INPUT_FREEZE),'sha256':sha(INPUT_FREEZE),
                      'cells':len(records),'matched_original':sum(r['original_input_present'] for r in records.values())}))


if __name__ == '__main__':
    main()
