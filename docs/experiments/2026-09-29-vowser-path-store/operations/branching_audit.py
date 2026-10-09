#!/usr/bin/env python3
"""실험 3 완료 셀의 입력·정답·원시 CSV 독립 감사; DB/worker 실행 없음."""

from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRANCH = ROOT / "branching"
RESULTS = BRANCH / "results"
OUT = ROOT / "operations" / "branching-audit.json"


def stable(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def digest(value: object) -> str:
    return hashlib.sha256(stable(value)).hexdigest()


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = fraction * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    return round(ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower), 3)


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mysql_plan_tables(value: object) -> list[dict]:
    found = []
    def walk(item: object) -> None:
        if isinstance(item, dict):
            if "table_name" in item:
                found.append({name: item.get(name) for name in
                              ("table_name", "access_type", "key", "used_key_parts", "rows_examined_per_scan")})
            for child in item.values():
                walk(child)
        elif isinstance(item, list):
            for child in item:
                walk(child)
    walk(value)
    return found


def is_timeout(row: dict) -> bool:
    detail = (row["error_type"] + " " + row["error"]).lower()
    return any(term in detail for term in (
        "timedout", "timed out", "timeout", "maximum statement execution time",
        "error 3024", "error 1205", "(3024,", "(1205,",
    ))


def inspect_expected(case: dict, expected: dict) -> dict:
    rows = expected["rows"]
    assert expected["case_id"] == case["case_id"]
    assert expected["sha256"] == case["oracle_sha256"] == digest(rows)
    paths = list(dict.fromkeys(row["path_id"] for row in rows))
    assert len(rows) == case["oracle_rows"]
    assert len(paths) == case["oracle_paths"] <= 3
    assert not any(row["step_id"] in case["blocked"] for row in rows)
    assert all((row["domain"], row["intent"], row["auth"]) ==
               (case["domain"], case["intent"], case["auth"]) for row in rows)
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["path_id"]].append(row)
    assert paths == sorted(paths, key=lambda p: (grouped[p][0]["depth"], p))
    for path_id, path_rows in grouped.items():
        depth = path_rows[0]["depth"]
        assert len(path_rows) == depth + 1
        assert [row["ordinal"] for row in path_rows] == list(range(depth + 1))
        assert all(row["depth"] == depth and row["path_id"] == path_id for row in path_rows)
    if case["scenario"] in ("none", "all_auth_steps", "common_auth"):
        assert not rows
    return {"rows": len(rows), "paths": len(paths),
            "bytes": len(stable(rows)), "target_present":
            case["target_depth"] in {r[0]["depth"] for r in grouped.values()}
            if case["target_depth"] is not None else None}


def audit_cell(folder: Path) -> dict | None:
    required = [folder / f"block-{engine}-r{round_number}.json"
                for engine in ("mysql", "neo4j") for round_number in range(3)]
    if not all(path.exists() for path in required):
        return None
    blocks = [json.loads(path.read_text()) for path in required]
    if not all(item.get("complete") is True for item in blocks):
        return None
    input_data = json.loads((folder / "input.json").read_text())
    mysql_plan = json.loads((folder / "plans-mysql.json").read_text())
    neo_plan = json.loads((folder / "plans-neo4j.json").read_text())
    member_tables = mysql_plan_tables(mysql_plan["mysql_member"])
    adj_tables = mysql_plan_tables(mysql_plan["mysql_adj"])
    plan_evidence = {
        "mysql_member_tables_preorder": member_tables,
        "mysql_adj_tables_preorder": adj_tables,
        "mysql_member_selected_paths_first": bool(member_tables and member_tables[0]["table_name"] == "e"),
        "neo_adj_node_index_seek": "NodeIndexSeek" in json.dumps(neo_plan["neo_adj_explain"]),
        "neo_member_node_index_seek": "NodeIndexSeek" in json.dumps(neo_plan["neo_member_explain"]),
    }
    cases = input_data["cases"]
    assert len(cases) == 200 and [case["case_id"] for case in cases] == list(range(200))
    assert digest([case["oracle_sha256"] for case in cases]) == input_data["oracle_manifest_sha256"]
    expected = [json.loads(line) for line in (folder / "expected.jsonl").read_text().splitlines()]
    assert len(expected) == 200
    input_stats = [inspect_expected(case, value) for case, value in zip(cases, expected)]
    scenarios = Counter(case["scenario"] for case in cases)
    assert scenarios["alternate"] == 160 and scenarios["none"] == 20
    assert scenarios["all_auth_steps"] + scenarios["common_auth"] == 20
    target_depths = Counter(case["target_depth"] for case in cases if case["scenario"] == "alternate")
    if "-d" not in folder.name:
        assert target_depths == Counter({5: 54, 10: 53, 20: 53})
    assert all(item["target_present"] for item, case in zip(input_stats, cases)
               if case["scenario"] == "alternate")

    mode_rows = defaultdict(list)
    wrong = Counter()
    failure_class = Counter()
    all_rows = []
    raw_hashes = {}
    for engine in ("mysql", "neo4j"):
        prefix = "neo" if engine == "neo4j" else "mysql"
        modes = (f"{prefix}_adj", f"{prefix}_member")
        for round_number in range(3):
            path = folder / f"raw-{engine}-r{round_number}.csv"
            with path.open(newline="") as stream:
                rows = list(csv.DictReader(stream))
            raw_hashes[path.name] = file_sha(path)
            assert len(rows) == 800
            block = next(item for item in blocks if item["engine"] == engine and
                         item["round"] == round_number)
            assert block["cell"] == folder.name
            observed = Counter((row["phase"], row["mode"]) for row in rows)
            assert observed == Counter({(phase, mode): 200 for phase in ("warmup", "measure")
                                        for mode in modes})
            for phase in ("warmup", "measure"):
                for mode in modes:
                    subset = [row for row in rows if row["phase"] == phase and row["mode"] == mode]
                    assert sorted(int(row["case_id"]) for row in subset) == list(range(200))
            for row in rows:
                case_id = int(row["case_id"])
                case, stats = cases[case_id], input_stats[case_id]
                assert row["cell"] == folder.name and int(row["round"]) == round_number
                assert row["scenario"] == case["scenario"]
                assert row["expected_sha256"] == case["oracle_sha256"]
                assert int(row["expected_paths"]) == stats["paths"]
                assert int(row["expected_rows"]) == stats["rows"]
                assert int(row["blocked_count"]) == len(case["blocked"])
                assert row["target_depth"] == (str(case["target_depth"])
                                                if case["target_depth"] is not None else "")
                if row["correct"] == "True":
                    assert row["result_sha256"] == case["oracle_sha256"]
                    assert int(row["result_paths"]) == stats["paths"]
                    assert int(row["result_rows"]) == stats["rows"]
                    assert int(row["result_bytes"]) == stats["bytes"]
                    assert not row["mismatch_codes"] and not row["error_type"]
                else:
                    wrong[(row["mode"], row["error_type"] or "wrong_result")] += 1
                    failure_class[(row["phase"], row["mode"],
                                   "timeout" if is_timeout(row) else "wrong_result"
                                   if row["error_type"] == "WrongResult" else "other_error")] += 1
                if row["phase"] == "measure":
                    mode_rows[(row["mode"], round_number)].append(row)
            all_rows.extend(rows)

    assert len(all_rows) == 4800
    mode_summary = {}
    for mode in ("mysql_adj", "neo_adj", "mysql_member", "neo_member"):
        rows = [row for round_number in range(3) for row in mode_rows[(mode, round_number)]]
        correct = [row for row in rows if row["correct"] == "True"]
        latencies = [float(row["elapsed_ms"]) for row in correct]
        mode_summary[mode] = {"attempts": len(rows), "correct": len(correct),
                              "timed_timeouts": sum(is_timeout(row) for row in rows),
                              "warmup_timeouts": sum(is_timeout(row) for row in all_rows
                                  if row["phase"] == "warmup" and row["mode"] == mode),
                              "p50_ms_correct": percentile(latencies, .5),
                              "p95_ms_correct": percentile(latencies, .95),
                              "rounds": {str(round_number): {
                                  "attempts": len(mode_rows[(mode, round_number)]),
                                  "correct": sum(row["correct"] == "True" for row in mode_rows[(mode, round_number)]),
                                  "p50_ms_correct": percentile([float(row["elapsed_ms"]) for row in
                                      mode_rows[(mode, round_number)] if row["correct"] == "True"], .5),
                                  "p95_ms_correct": percentile([float(row["elapsed_ms"]) for row in
                                      mode_rows[(mode, round_number)] if row["correct"] == "True"], .95)}
                                  for round_number in range(3)}}
    return {"cell": folder.name, "input_sha256": file_sha(folder / "input.json"),
            "expected_sha256": file_sha(folder / "expected.jsonl"), "raw_sha256": raw_hashes,
            "case_context_signature_sha256": digest([
                {**{name: case[name] for name in ("case_id", "source_path",
                    "target_depth", "domain", "intent", "auth")},
                 "scenario_family": "auth" if case["scenario"] in
                    ("all_auth_steps", "common_auth") else case["scenario"]}
                for case in cases]),
            "scenarios": dict(scenarios), "target_depths": dict(target_depths),
            "input_stats": input_data["stats"], "wrong": {str(k): v for k, v in wrong.items()},
            "failure_class": {str(k): v for k, v in failure_class.items()},
            "plan_evidence": plan_evidence,
            "warmup_attempts": 2400, "measured_attempts": 2400,
            "mode": mode_summary}


def main() -> None:
    preflight = json.loads((RESULTS / "preflight-main.json").read_text())
    freeze = {name: file_sha(BRANCH / name) == expected
              for name, expected in preflight["experiment_file_sha256"].items()}
    freeze["shared/data.py"] = file_sha(ROOT / "shared" / "data.py") == preflight["shared_data_sha256"]
    assert all(freeze.values()), freeze
    storage = (BRANCH / "storage.py").read_text()
    baseline = {
        "mysql_context_index_defined": "KEY br3_context" in storage,
        "mysql_membership_path_ordinal_pk_defined": "PRIMARY KEY (condition_id,path_id,ordinal)" in storage,
        "mysql_membership_step_index_defined": "KEY br3_member_step" in storage,
        "mysql_adj_recursive_and_link_keys": "WITH RECURSIVE roots" in storage and
                                               "n.path_id=w.path_id" in storage and
                                               "n.from_step_id=w.step_id" in storage,
        "neo_member_context_index": "CREATE INDEX br3_path_context" in storage,
        "neo_member_negative_blocked_filter": "MATCH (p)-[:BR3_MEMBER]->(b:BR3_Step)" in storage and
                                              "b.stepId IN $blocked" in storage,
        "neo_adj_path_and_ordinal_guard": "r.pathId=p.pathId" in storage and
                                           "relationships(route)[i].ordinal=i" in storage,
    }
    assert all(baseline.values()), baseline
    completed = []
    pending = []
    for folder in sorted(RESULTS.iterdir()):
        if not folder.is_dir() or not folder.name.startswith("n"):
            continue
        item = audit_cell(folder)
        if item is None:
            pending.append(folder.name)
        else:
            completed.append(item)
    result = {"utc": datetime.now(timezone.utc).isoformat(), "preflight_source_sha256":
              file_sha(RESULTS / "preflight-main.json"), "freeze_matches": freeze,
              "baseline_review": baseline, "complete_cells": len(completed),
              "pending_cell_names": pending, "cells": completed}
    signatures = defaultdict(set)
    for item in completed:
        size = item["input_stats"]["registered_paths"]
        depth_group = next((part for part in item["cell"].split("-") if part.startswith("d")), "main")
        signatures[(size, depth_group)].add(item["case_context_signature_sha256"])
    result["paired_context_order_equal"] = {f"{size}-{depth}": len(values) == 1
                                             for (size, depth), values in signatures.items()}
    assert all(result["paired_context_order_equal"].values())
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"PASS {len(completed)} complete cells; {len(pending)} partial/other cell directories skipped")


if __name__ == "__main__":
    main()
