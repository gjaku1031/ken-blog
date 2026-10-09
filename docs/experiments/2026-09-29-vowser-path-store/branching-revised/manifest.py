"""교정 코호트의 코드·원본·20셀 입력 SHA 동결 및 실행시 검증."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RESULTS = HERE/'results'
FREEZE = RESULTS/'freeze.json'
INPUT_FREEZE = RESULTS/'input-freeze.json'
SOURCE = Path('/home/ubuntu/Develop/project/vowser/vowser-agent-server/app/services/neo4j_service.py')
ORIGINAL = ROOT/'branching'
SOURCE_FILES = ('PROTOCOL.md','manifest.py','inputs.py','worker.py','orchestrate.py',
                'rawcheck.py','run.sh','managed.sh')


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n')


def present() -> dict:
    old = json.loads((ORIGINAL/'results/preflight-main.json').read_text())
    # worker에는 experiments/2026-09-29만 /work로 마운트된다. 원본 제품
    # 파일의 실제 SHA/HEAD는 host freeze 단계에서 확인하고 worker는 그 증거를 읽는다.
    if SOURCE.exists():
        head = subprocess.check_output(['git','-C',str(SOURCE.parents[2]),'rev-parse','HEAD'],text=True).strip()
        source = sha(SOURCE)
    else:
        head,source = old['agent_server_head'],old['source_sha256']
    shared = sha(ROOT/'shared/data.py')
    if (head,source,shared) != (old['agent_server_head'],old['source_sha256'],old['shared_data_sha256']):
        raise AssertionError('original product/shared data identity changed')
    original_files = {name:sha(ORIGINAL/name) for name in old['experiment_file_sha256']}
    if original_files != old['experiment_file_sha256']:
        raise AssertionError('original 9-file execution cohort changed')
    return {
        'agent_server_head':head,'source_sha256':source,'shared_data_sha256':shared,
        'original_preflight_sha256':sha(ORIGINAL/'results/preflight-main.json'),
        'original_execution_files_sha256':original_files,
        'revised_files_sha256':{name:sha(HERE/name) for name in SOURCE_FILES},
        'shared_run_client_sha256':sha(ROOT/'shared/run-client.sh'),
        'environment_revised_sha256':sha(ROOT/'shared/environment-branching-revised.json'),
        'input_freeze_sha256':sha(INPUT_FREEZE),
        'cohort':'branching-revised-ordered-membership',
    }


def freeze() -> dict:
    if FREEZE.exists():
        raise FileExistsError(f'freeze already exists: {FREEZE}')
    values = present()
    values['frozen_utc'] = datetime.now(timezone.utc).isoformat()
    write_json(FREEZE,values)
    return values


def verify() -> dict:
    saved = json.loads(FREEZE.read_text())
    current = present()
    for key,value in current.items():
        if saved.get(key) != value:
            raise AssertionError(f'revised freeze changed: {key}')
    return saved


def verify_cell(cell: str) -> dict:
    frozen = json.loads(INPUT_FREEZE.read_text())
    cells = frozen['cells']
    if cell not in cells:
        raise AssertionError(f'cell outside input freeze: {cell}')
    record = cells[cell]
    path = RESULTS/cell
    for name in ('input.json','expected.jsonl'):
        if sha(path/name) != record[name]['sha256']:
            raise AssertionError(f'input freeze mismatch: {cell}/{name}')
    return record


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('action',choices=('freeze','verify'))
    args = parser.parse_args()
    value = freeze() if args.action == 'freeze' else verify()
    print(json.dumps({'action':args.action,'cohort':value['cohort'],
                      'freeze_sha256':sha(FREEZE),'files':len(value['revised_files_sha256'])}))


if __name__ == '__main__':
    main()
