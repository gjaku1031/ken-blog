#!/usr/bin/env python3
"""교정 분기 코호트의 완료 셀·원본 동일 입력·원시 CSV 독립 감사."""

from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRANCH = ROOT / "branching-revised"
RESULTS = BRANCH / "results"
OUT = ROOT / "operations" / "branching-revised-audit.json"


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


def measured_stratum(rows: list[dict]) -> dict:
    correct = [row for row in rows if row["correct"] == "True"]
    elapsed = [float(row["elapsed_ms"]) for row in correct]
    return {"attempts": len(rows), "correct": len(correct),
            "timeouts": sum(is_timeout(row) for row in rows),
            "p50_ms_correct": percentile(elapsed, .5),
            "p95_ms_correct": percentile(elapsed, .95)}


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
    mysql_plan = json.loads((folder / "plans-mysql.json").read_text())["answerable"]
    neo_plan = json.loads((folder / "plans-neo4j.json").read_text())["answerable"]
    assert mysql_plan["mysql_member_ordered"]["passed"] is True
    assert all(mysql_plan["mysql_member_ordered"]["checks"].values())
    ordered_plan = mysql_plan["mysql_member_ordered"]["plan"]
    outer = [item["table"] for item in
             ordered_plan["query_block"]["ordering_operation"]["nested_loop"]]
    assert [item["table_name"] for item in outer] == ["e", "m", "s"]
    assert outer[1]["access_type"] == "ref"
    assert outer[1]["used_key_parts"][:2] == ["condition_id", "path_id"]
    assert outer[2]["access_type"] == "eq_ref"
    assert outer[2]["used_key_parts"][:2] == ["condition_id", "step_id"]
    member_tables = mysql_plan_tables(ordered_plan)
    adj_tables = mysql_plan_tables(mysql_plan["mysql_adj"]["plan"])
    plan_evidence = {
        "mysql_member_ordered_tables_preorder": member_tables,
        "mysql_member_ordered_outer_loop": [
            {name: item.get(name) for name in
             ("table_name", "access_type", "key", "used_key_parts", "rows_examined_per_scan")}
            for item in outer],
        "mysql_adj_tables_preorder": adj_tables,
        "mysql_member_ordered_selected_paths_first": bool(member_tables and member_tables[0]["table_name"] == "e"),
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
        modes = (f"{prefix}_adj", "mysql_member_ordered" if engine == "mysql" else "neo_member")
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
    for mode in ("mysql_adj", "neo_adj", "mysql_member_ordered", "neo_member"):
        rows = [row for round_number in range(3) for row in mode_rows[(mode, round_number)]]
        mode_summary[mode] = {**measured_stratum(rows),
                              "timed_timeouts": sum(is_timeout(row) for row in rows),
                              "warmup_timeouts": sum(is_timeout(row) for row in all_rows
                                  if row["phase"] == "warmup" and row["mode"] == mode),
                              "rounds": {str(round_number): measured_stratum(mode_rows[(mode, round_number)])
                                         for round_number in range(3)},
                              "scenario": {scenario: measured_stratum([row for row in rows
                                  if row["scenario"] == scenario]) for scenario in sorted(scenarios)},
                              "target_depth": {depth: measured_stratum([row for row in rows
                                  if (row["target_depth"] or "none") == depth])
                                  for depth in sorted({row["target_depth"] or "none" for row in rows})},
                              "scenario_target_depth": {
                                  f"{scenario}|{depth}": measured_stratum([row for row in rows
                                      if row["scenario"] == scenario and
                                         (row["target_depth"] or "none") == depth])
                                  for scenario, depth in sorted({(row["scenario"], row["target_depth"] or "none")
                                                                 for row in rows})}}
    # 사후 기술 envelope: 결과를 보고 고른 최소값이므로 사전 지정된 단일 주지표가 아니다.
    eligible = lambda mode: mode_summary[mode]["attempts"] == mode_summary[mode]["correct"] == 600
    best_by_engine = {}
    for engine, modes in (("mysql", ("mysql_adj", "mysql_member_ordered")),
                          ("neo4j", ("neo_adj", "neo_member"))):
        valid = [mode for mode in modes if eligible(mode)]
        best_by_engine[engine] = {
            metric: (min(({"mode": mode, "ms": mode_summary[mode][metric]} for mode in valid),
                         key=lambda item: (item["ms"], item["mode"])) if valid else None)
            for metric in ("p50_ms_correct", "p95_ms_correct")}
    same_pattern = {}
    for name, mysql_mode, neo_mode in (("adjacency", "mysql_adj", "neo_adj"),
                                       ("membership", "mysql_member_ordered", "neo_member")):
        same_pattern[name] = {metric: {
            "mysql_ms": mode_summary[mysql_mode][metric],
            "neo4j_ms": mode_summary[neo_mode][metric],
            "winner": ("mysql" if mode_summary[mysql_mode][metric] < mode_summary[neo_mode][metric]
                       else "neo4j" if mode_summary[neo_mode][metric] < mode_summary[mysql_mode][metric]
                       else "tie") if eligible(mysql_mode) and eligible(neo_mode) else None,
        } for metric in ("p50_ms_correct", "p95_ms_correct")}
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
            "mode": mode_summary,
            "same_pattern": same_pattern,
            "best_by_engine_descriptive": best_by_engine}


def winner_counts(items: list[dict]) -> dict:
    return {
        metric: {
            "same_pattern": {pattern: dict(Counter(
                item["same_pattern"][pattern][metric]["winner"] for item in items
                if item["same_pattern"][pattern][metric]["winner"] is not None))
                for pattern in ("adjacency", "membership")},
            "best_valid_engine_envelope": dict(Counter(
                ("mysql" if item["best_by_engine_descriptive"]["mysql"][metric]["ms"] <
                 item["best_by_engine_descriptive"]["neo4j"][metric]["ms"] else
                 "neo4j" if item["best_by_engine_descriptive"]["neo4j"][metric]["ms"] <
                 item["best_by_engine_descriptive"]["mysql"][metric]["ms"] else "tie")
                for item in items if all(item["best_by_engine_descriptive"][engine][metric]
                                          for engine in ("mysql", "neo4j"))))
        } for metric in ("p50_ms_correct", "p95_ms_correct")}


def main() -> None:
    preflight = json.loads((RESULTS / "freeze.json").read_text())
    freeze = {name: file_sha(BRANCH / name) == expected
              for name, expected in preflight["revised_files_sha256"].items()}
    freeze["shared/data.py"] = file_sha(ROOT / "shared" / "data.py") == preflight["shared_data_sha256"]
    freeze["shared/run-client.sh"] = file_sha(ROOT / "shared" / "run-client.sh") == preflight["shared_run_client_sha256"]
    freeze["shared/environment-branching-revised.json"] = file_sha(
        ROOT / "shared" / "environment-branching-revised.json") == preflight["environment_revised_sha256"]
    freeze["input-freeze.json"] = file_sha(RESULTS / "input-freeze.json") == preflight["input_freeze_sha256"]
    freeze.update({"original/" + name: file_sha(ROOT / "branching" / name) == expected
                   for name, expected in preflight["original_execution_files_sha256"].items()})
    assert all(freeze.values()), freeze
    storage = (ROOT / "branching" / "storage.py").read_text()
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
    input_freeze = json.loads((RESULTS / "input-freeze.json").read_text())["cells"]
    for cell, record in input_freeze.items():
        folder = RESULTS / cell
        assert file_sha(folder / "input.json") == record["input.json"]["sha256"]
        assert file_sha(folder / "expected.jsonl") == record["expected.jsonl"]["sha256"]
        if record["original_input_present"]:
            original = ROOT / "branching" / "results" / cell
            assert file_sha(original / "input.json") == file_sha(folder / "input.json")
            assert file_sha(original / "expected.jsonl") == file_sha(folder / "expected.jsonl")
    for folder in sorted(RESULTS.iterdir()):
        if not folder.is_dir() or not folder.name.startswith("n"):
            continue
        item = audit_cell(folder)
        if item is None:
            pending.append(folder.name)
        else:
            completed.append(item)
    result = {"preflight_source_sha256":
              file_sha(RESULTS / "freeze.json"), "freeze_matches": freeze,
              "baseline_review": baseline, "complete_cells": len(completed),
              "pending_cell_names": pending, "frozen_input_cells": len(input_freeze),
              "original_input_pairs_identical": sum(record["original_input_present"] for record in input_freeze.values()),
              "cells": completed}
    signatures = defaultdict(set)
    for item in completed:
        size = item["input_stats"]["registered_paths"]
        depth_group = next((part for part in item["cell"].split("-") if part.startswith("d")), "main")
        signatures[(size, depth_group)].add(item["case_context_signature_sha256"])
    result["paired_context_order_equal"] = {f"{size}-{depth}": len(values) == 1
                                             for (size, depth), values in signatures.items()}
    assert all(result["paired_context_order_equal"].values())
    result["descriptive_winner_counts"] = winner_counts(completed)
    result["scope_summary"] = {}
    for scope, items in (("main", [item for item in completed if "-d" not in item["cell"]]),
                         ("stress", [item for item in completed if "-d" in item["cell"]])):
        modes = [mode for item in items for mode in item["mode"].values()]
        result["scope_summary"][scope] = {
            "cells": len(items),
            "measured_attempts": sum(mode["attempts"] for mode in modes),
            "measured_correct": sum(mode["correct"] for mode in modes),
            "measured_timeouts": sum(mode["timed_timeouts"] for mode in modes),
            "warmup_attempts": len(items) * 2400,
            "warmup_timeouts": sum(mode["warmup_timeouts"] for mode in modes),
            "winner_counts": winner_counts(items),
        }
    attempt_evidence = {}
    for status_path in sorted(RESULTS.glob("run-*.json")):
        status = json.loads(status_path.read_text())
        if status["state"] == "running":
            continue
        assert status["freeze_sha256"] == file_sha(RESULTS / "freeze.json")
        checked_blocks = 0
        for cell, blocks in status.get("block_evidence", {}).items():
            for key, evidence in blocks.items():
                engine, round_name = key.rsplit("-r", 1)
                for kind, filename in (("raw", f"raw-{engine}-r{round_name}.csv"),
                                       ("summary", f"block-{engine}-r{round_name}.json")):
                    assert file_sha(RESULTS / cell / filename) == evidence[kind]["sha256"]
                checked_blocks += 1
        for cell, evidence in status.get("cell_evidence", {}).items():
            for kind, filename in (("raw", "raw.csv"), ("summary", "summary.json")):
                assert file_sha(RESULTS / cell / filename) == evidence[kind]["sha256"]
        attempt_evidence[status_path.name] = {"state": status["state"],
                                              "completed_cells": len(status.get("completed_cells", [])),
                                              "preserved_blocks_checked": checked_blocks,
                                              "combined_cells_checked": len(status.get("cell_evidence", {}))}
    result["closed_attempt_evidence"] = attempt_evidence
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"PASS {len(completed)} complete cells; {len(pending)} partial/other cell directories skipped")


if __name__ == "__main__":
    main()
