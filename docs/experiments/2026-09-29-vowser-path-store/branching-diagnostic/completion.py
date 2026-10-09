"""원본 20셀 완료를 원본/continuation 상태와 전체 raw로 읽기 전용 검증."""

from __future__ import annotations

import json
from pathlib import Path

from branching.continue_run import input_evidence, sha, validate_cell
from branching.model import CELLS, STRESS_CELLS, cell_id

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "branching" / "results"


def expected_cells(group: str) -> list[str]:
    if group == "main":
        return [cell_id(*item) for item in CELLS]
    if group == "stress":
        return [cell_id(total, share, cap, depth)
                for total, depth, share, cap in STRESS_CELLS]
    raise ValueError(group)


def continuation_statuses(group: str, first_path: Path, cells: list[str]) -> list[dict]:
    first_sha = sha(first_path)
    candidates = []
    for path in sorted(RESULTS.glob(f"continuation-{group}-*.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        if record.get("state") != "complete":
            continue
        if record.get("group") != group or record.get("completed_cells") != cells:
            raise AssertionError(f"complete continuation has wrong group/cell list: {path.name}")
        prior = record.get("first_attempt", {}).get("status", {})
        if prior.get("sha256") != first_sha:
            raise AssertionError(f"continuation first-attempt SHA mismatch: {path.name}")
        if set(record.get("input_evidence", {})) != set(cells):
            raise AssertionError(f"continuation input evidence incomplete: {path.name}")
        if set(record.get("block_evidence", {})) != set(cells):
            raise AssertionError(f"continuation block evidence incomplete: {path.name}")
        candidates.append({"path": path, "record": record})
    if not candidates:
        raise RuntimeError(f"original {group} stopped without a complete continuation")
    return candidates


def completed_groups() -> dict:
    """상태 표시만 믿지 않고 전 셀의 6블록·합본·oracle SHA를 재검산."""
    result = {}
    for group in ("main", "stress"):
        cells = expected_cells(group)
        first_path = RESULTS / ("run-status.json" if group == "main" else "stress-run-status.json")
        first = json.loads(first_path.read_text(encoding="utf-8"))
        if first.get("group") != group:
            raise AssertionError(f"wrong original group: {first_path.name}")
        if first.get("state") == "complete":
            if first.get("completed_cells") != cells:
                raise AssertionError(f"original {group} marked complete with wrong cells")
            continuations = []
            origin = "first_attempt"
        elif first.get("state") in ("time_limit_incomplete", "interrupted"):
            continuations = continuation_statuses(group, first_path, cells)
            origin = "continuation"
        else:
            raise RuntimeError(f"original {group} still {first.get('state')}")
        audited = {}
        for cell in cells:
            folder = RESULTS / cell
            source = input_evidence(folder)
            if source is None:
                raise AssertionError(f"original input/oracle missing: {cell}")
            full = validate_cell(folder, cell)
            if full is None:
                raise AssertionError(f"original full raw/block incomplete: {cell}")
            expected_blocks = {f"{engine}-r{round_number}"
                               for engine in ("mysql", "neo4j") for round_number in (0, 1, 2)}
            if set(full["blocks"]) != expected_blocks:
                raise AssertionError(f"original six-block evidence incomplete: {cell}")
            for continuation in continuations:
                saved = continuation["record"]
                prior_input = saved["input_evidence"][cell]
                if isinstance(prior_input, dict) and "after_reload" in prior_input:
                    prior_input = prior_input["after_reload"]
                if prior_input != source:
                    raise AssertionError(f"continuation input evidence changed: {cell}")
                prior_blocks = saved["block_evidence"][cell]
                if set(prior_blocks) != expected_blocks:
                    raise AssertionError(f"continuation block evidence keys changed: {cell}")
                for block_name in expected_blocks:
                    for kind in ("raw", "summary"):
                        if prior_blocks[block_name][kind]["sha256"] != full["blocks"][block_name][kind]["sha256"]:
                            raise AssertionError(f"continuation block SHA changed: {cell} {block_name} {kind}")
            audited[cell] = {"input_sha256": source["sha256"],
                             "expected_jsonl_sha256": source["expected_jsonl_sha256"],
                             "raw_sha256": full["raw"]["sha256"],
                             "summary_sha256": full["summary"]["sha256"],
                             "block_sha256": {name: {kind: value[kind]["sha256"]
                                                     for kind in ("raw", "summary")}
                                              for name, value in full["blocks"].items()}}
        result[group] = {"origin": origin, "first_status_path": str(first_path.relative_to(ROOT)),
                         "first_status_sha256": sha(first_path),
                         "complete_continuations": [{"path": str(item["path"].relative_to(ROOT)),
                                                     "sha256": sha(item["path"])}
                                                    for item in continuations],
                         "cell_names": cells, "audited_cells": audited}
    return result
