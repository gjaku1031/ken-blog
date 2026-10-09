"""완료 800/4,800행의 정합, 결합 동일성 및 중단 원시자료 보존."""

from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

from branching.model import digest, stable_json
from manifest import RESULTS, sha, verify_cell, write_json

FIELDS = (
    'cell','phase','round','mode','case_id','scenario','source_path','target_depth',
    'blocked_count','expected_paths','expected_rows','expected_sha256',
    'result_paths','result_rows','result_sha256','result_bytes','elapsed_ms',
    'correct','error_type','error','mismatch_codes','observed_json_if_wrong',
)
MODES = ('neo_adj','mysql_adj','neo_member','mysql_member_ordered')


def path_item(path: Path) -> dict:
    return {'path':str(path.resolve().relative_to(RESULTS.resolve())),
            'bytes':path.stat().st_size,'sha256':sha(path)}


def rows(path: Path) -> list[dict]:
    with path.open(newline='') as file:
        reader = csv.DictReader(file,strict=True)
        if tuple(reader.fieldnames or ()) != FIELDS:
            raise AssertionError(f'raw header changed: {path}')
        return list(reader)


def order(round_number: int):
    return ('mysql','neo4j') if round_number % 2 == 0 else ('neo4j','mysql')


def engine_modes(engine: str) -> tuple[str,str]:
    if engine == 'mysql':
        return ('mysql_adj','mysql_member_ordered')
    if engine == 'neo4j':
        return ('neo_adj','neo_member')
    raise ValueError(engine)


def input_rows(folder: Path) -> tuple[list[dict],list[dict]]:
    verify_cell(folder.name)
    payload = json.loads((folder/'input.json').read_text())
    cases = payload['cases']
    expected = [json.loads(line) for line in (folder/'expected.jsonl').read_text().splitlines()]
    if len(cases) != 200 or len(expected) != 200 or [c['case_id'] for c in cases] != list(range(200)):
        raise AssertionError(f'input case count/order changed: {folder}')
    if digest([c['oracle_sha256'] for c in cases]) != payload['oracle_manifest_sha256']:
        raise AssertionError(f'input oracle manifest changed: {folder}')
    if any(e['case_id'] != c['case_id'] or e['sha256'] != c['oracle_sha256'] or
           digest(e['rows']) != e['sha256'] for c,e in zip(cases,expected)):
        raise AssertionError(f'expected full oracle changed: {folder}')
    return cases,expected


def block(folder: Path, engine: str, round_number: int) -> dict | None:
    summary_path = folder/f'block-{engine}-r{round_number}.json'
    raw_path = folder/f'raw-{engine}-r{round_number}.csv'
    if not summary_path.exists():
        return None
    summary = json.loads(summary_path.read_text())
    if not summary.get('complete'):
        return None
    if not raw_path.exists():
        raise AssertionError(f'complete block raw missing: {raw_path}')
    actual = rows(raw_path)
    if len(actual) != 800:
        raise AssertionError(f'complete block row count changed: {raw_path}')
    desired = Counter((phase,mode,case_id) for phase in ('warmup','measure')
                      for mode in engine_modes(engine) for case_id in range(200))
    if Counter((r['phase'],r['mode'],int(r['case_id'])) for r in actual) != desired or any(
        r['cell'] != folder.name or int(r['round']) != round_number for r in actual):
        raise AssertionError(f'complete block case coverage changed: {raw_path}')
    cases,expected = input_rows(folder)
    for row in actual:
        index = int(row['case_id'])
        case,oracle = cases[index],expected[index]
        display = lambda value: '' if value is None else str(value)
        if (row['expected_sha256'] != case['oracle_sha256'] or
            int(row['expected_rows']) != case['oracle_rows'] or
            int(row['expected_paths']) != case['oracle_paths'] or
            int(row['blocked_count']) != len(case['blocked']) or
            row['scenario'] != case['scenario'] or
            row['source_path'] != display(case['source_path']) or
            row['target_depth'] != display(case.get('target_depth'))):
            raise AssertionError(f'block expected metadata changed: {raw_path} case {index}')
        if row['correct'] not in ('True','False'):
            raise AssertionError(f'block correct flag malformed: {raw_path} case {index}')
        if row['correct'] == 'True' and (
            row['result_sha256'] != oracle['sha256'] or row['error_type'] or row['error'] or
            int(row['result_rows']) != case['oracle_rows'] or
            int(row['result_paths']) != case['oracle_paths'] or
            int(row['result_bytes']) != len(stable_json(oracle['rows']))):
            raise AssertionError(f'block successful payload metadata changed: {raw_path} case {index}')
    return {'raw':path_item(raw_path),'summary':path_item(summary_path),
            'attempts':800,'measured_attempts':400,
            'correct':sum(r['correct']=='True' for r in actual)}


def cell(folder: Path) -> dict | None:
    summary_path = folder/'summary.json'
    combined = folder/'raw.csv'
    if not summary_path.exists():
        return None
    summary = json.loads(summary_path.read_text())
    if not summary.get('complete'):
        return None
    if not combined.exists():
        raise AssertionError(f'complete cell raw missing: {combined}')
    blocks = {}
    expected_rows = []
    for round_number in (0,1,2):
        for engine in order(round_number):
            checked = block(folder,engine,round_number)
            if checked is None:
                raise AssertionError(f'complete cell block incomplete: {folder.name} {engine} r{round_number}')
            blocks[f'{engine}-r{round_number}'] = checked
            expected_rows.extend(rows(folder/f'raw-{engine}-r{round_number}.csv'))
    combined_rows = rows(combined)
    if len(combined_rows) != 4800 or combined_rows != expected_rows:
        raise AssertionError(f'complete cell combined raw differs from six blocks: {folder.name}')
    return {'raw':path_item(combined),'summary':path_item(summary_path),'blocks':blocks}


def archive_partial(folder: Path, names: list[str], archive: Path) -> list[dict]:
    archive.mkdir(parents=True,exist_ok=True)
    saved = []
    for name in names:
        source = folder/name
        if not source.exists():
            continue
        target = archive/name
        if target.exists():
            raise FileExistsError(f'partial archive exists: {target}')
        evidence = path_item(source)
        source.rename(target)
        evidence['archive'] = str(target.resolve().relative_to(RESULTS.resolve()))
        if name.endswith('.csv'):
            parsed = 0
            try:
                with target.open(newline='') as file:
                    for _ in csv.DictReader(file,strict=True):
                        parsed += 1
                if target.stat().st_size and not target.read_bytes().endswith(b'\n'):
                    parsed = max(0,parsed-1)
                evidence['parse_error'] = None
            except Exception as exc:
                evidence['parse_error'] = f'{type(exc).__name__}: {exc}'[:500]
            evidence['parseable_rows_lower_bound'] = parsed
            evidence['issued_attempts_exact'] = None
        saved.append(evidence)
    return saved


def combine(folder: Path) -> dict:
    path = folder/'raw.csv'
    if path.exists():
        raise FileExistsError(f'combined raw already exists: {path}')
    with path.open('x',newline='') as output:
        writer = csv.DictWriter(output,fieldnames=FIELDS)
        writer.writeheader()
        for round_number in (0,1,2):
            for engine in order(round_number):
                if block(folder,engine,round_number) is None:
                    raise AssertionError(f'cannot combine incomplete block: {folder.name} {engine} r{round_number}')
                writer.writerows(rows(folder/f'raw-{engine}-r{round_number}.csv'))
    summary = {'cell':folder.name,'complete':True,'raw_attempts':4800,
               'warmup_attempts':2400,'measured_attempts':2400,
               'raw_sha256':sha(path)}
    write_json(folder/'summary.json',summary)
    verified = cell(folder)
    if verified is None:
        raise AssertionError(f'combined cell validation failed: {folder.name}')
    return verified
