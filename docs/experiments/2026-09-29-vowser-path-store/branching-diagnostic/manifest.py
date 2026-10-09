#!/usr/bin/env python3
"""사후 MySQL 조인 순서 진단의 입력·원본 소스·신규 코드 SHA 고정."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from branching.model import CELLS, STRESS_CELLS, cell_id

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "input-manifest.json"
SOURCE = (
    "branching/PROTOCOL.md", "branching/model.py", "branching/storage.py",
    "branching/bench.py", "branching/worker.py", "branching/orchestrate.py",
    "branching/continue_run.py",
    "shared/data.py", "shared/connect.py", "shared/run-client.sh",
    "shared/db-control.sh", "branching-diagnostic/DESIGN.md",
    "branching-diagnostic/manifest.py", "branching-diagnostic/worker.py",
    "branching-diagnostic/host.py", "branching-diagnostic/run.sh",
    "branching-diagnostic/audit.py", "branching-diagnostic/managed.sh",
    "branching-diagnostic/completion.py",
    "branching/summarize.py", "operations/results/storage-medium.json",
)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def cell_names() -> list[str]:
    names = [cell_id(*item) for item in CELLS]
    names.extend(cell_id(total, share, cap, depth) for total, depth, share, cap in STRESS_CELLS)
    assert len(names) == len(set(names)) == 20
    return names


def files() -> dict[str, str]:
    mapping = {path: sha256(ROOT / path) for path in SOURCE}
    for cell in cell_names():
        for name in ("input.json", "expected.jsonl"):
            relative = f"branching/results/{cell}/{name}"
            mapping[relative] = sha256(ROOT / relative)
    return mapping


def verify() -> dict:
    record = json.loads(MANIFEST.read_text(encoding="utf-8"))
    actual = files()
    if actual != record["sha256"]:
        changed = sorted(set(actual) | set(record["sha256"]))
        changed = [name for name in changed if actual.get(name) != record["sha256"].get(name)]
        raise RuntimeError(f"posthoc diagnostic frozen input/source changed: {changed}")
    return record


def verify_cell(cell: str) -> dict:
    record = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if cell not in record["cell_names"]:
        raise ValueError(f"cell outside posthoc frozen matrix: {cell}")
    paths = list(SOURCE) + [f"branching/results/{cell}/{name}" for name in ("input.json", "expected.jsonl")]
    changed = [name for name in paths if sha256(ROOT / name) != record["sha256"].get(name)]
    if changed:
        raise RuntimeError(f"posthoc source/cell inputs changed: {changed}")
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("create", "verify"))
    args = parser.parse_args()
    if args.action == "create":
        if MANIFEST.exists():
            raise RuntimeError("diagnostic input manifest already exists")
        from completion import completed_groups
        original_completion = completed_groups()
        record = {
            "scope": "posthoc mysql_member_ordered arm; original four arms unchanged",
            "cell_names": cell_names(),
            "original_completion": original_completion,
            "resource_contract": {"db_nano_cpus": 1_000_000_000,
                                  "db_memory_bytes": 3 * 1024**3,
                                  "worker_nano_cpus": 1_000_000_000,
                                  "worker_memory_bytes": 1024**3,
                                  "mysql_max_execution_time_ms": 2000,
                                  "warmup_per_cell_round": 200,
                                  "measured_per_cell_round": 200,
                                  "rounds": 3},
            "sha256": files(),
        }
        MANIFEST.write_text(json.dumps(record, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({"status": "created", "cells": len(record["cell_names"]),
                          "manifest_sha256": sha256(MANIFEST)}))
    else:
        record = verify()
        print(json.dumps({"status": "verified", "cells": len(record["cell_names"]),
                          "manifest_sha256": sha256(MANIFEST)}))


if __name__ == "__main__":
    main()
