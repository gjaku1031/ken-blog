"""사후 단일군의 원시 CSV를 독립 검산하고 별도 결과 요약을 작성한다."""

from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

from branching.summarize import describe
from manifest import HERE, ROOT, cell_names, sha256, verify

OUT = HERE / "results"
MODE = "mysql_member_ordered"


def timeout(row: dict) -> bool:
    value = (row["error_type"] + " " + row["error"]).lower()
    return any(token in value for token in (
        "3024", "maximum statement execution time", "timed out", "timeout",
        "exceeded the configured timeout",
    ))


def describe_posthoc(rows: list[dict]) -> dict:
    metrics = describe(rows)
    metrics["timeouts"] = sum(timeout(row) for row in rows)
    metrics["other_errors"] = sum(row["error_type"] not in ("", "WrongResult") and not timeout(row)
                                  for row in rows)
    return metrics


def read_raw(cell: str) -> tuple[list[dict], list[str]]:
    folder = OUT / cell
    combined = folder / "raw.csv"
    sources = [combined] if combined.exists() else sorted(folder.glob("raw-r*.csv"))
    rows: list[dict] = []
    for path in sources:
        with path.open(newline="", encoding="utf-8") as file:
            rows.extend(csv.DictReader(file))
    return rows, [str(path.relative_to(HERE)) for path in sources]


def audit_cell(cell: str) -> dict:
    original = ROOT / "branching" / "results" / cell
    inputs = json.loads((original / "input.json").read_text(encoding="utf-8"))
    cases = {str(case["case_id"]): case for case in inputs["cases"]}
    rows, sources = read_raw(cell)
    seen = Counter()
    violations = []
    for index, row in enumerate(rows):
        key = (row["phase"], row["round"], row["case_id"])
        seen[key] += 1
        case = cases.get(row["case_id"])
        if row["cell"] != cell or row["mode"] != MODE or row["phase"] not in ("warmup", "measure"):
            violations.append([index, "cell/mode/phase"])
        if row["round"] not in ("0", "1", "2") or case is None:
            violations.append([index, "round/case"])
            continue
        if any((row["scenario"] != case["scenario"],
                row["expected_sha256"] != case["oracle_sha256"],
                int(row["expected_paths"]) != case["oracle_paths"],
                int(row["expected_rows"]) != case["oracle_rows"],
                int(row["blocked_count"]) != len(case["blocked"]))):
            violations.append([index, "input/oracle metadata"])
        if row["correct"] == "True" and row["result_sha256"] != case["oracle_sha256"]:
            violations.append([index, "correct flag contradicts SHA"])
    duplicates = {str(key): count for key, count in seen.items() if count != 1}
    measured = [row for row in rows if row["phase"] == "measure"]
    warmup = [row for row in rows if row["phase"] == "warmup"]
    expected_keys = {(phase, str(round_number), case_id)
                     for phase in ("warmup", "measure")
                     for round_number in (0, 1, 2) for case_id in cases}
    missing = len(expected_keys - set(seen))
    metrics = describe_posthoc(measured)
    metrics["timeout_error_samples"] = dict(Counter(
        row["error_type"] + ": " + row["error"][:180]
        for row in measured if timeout(row)))
    scenarios = sorted({row["scenario"] for row in measured})
    by_scenario = {scenario: describe_posthoc([row for row in measured if row["scenario"] == scenario])
                   for scenario in scenarios}
    by_round = {str(n): describe_posthoc([row for row in measured if row["round"] == str(n)])
                for n in (0, 1, 2)}
    by_depth = {depth: describe_posthoc([row for row in measured if row["scenario"] == "alternate"
                                and row["target_depth"] == depth])
                for depth in sorted({row["target_depth"] for row in measured
                                     if row["target_depth"]})}
    plan_path = OUT / cell / "plans.json"
    plans = json.loads(plan_path.read_text(encoding="utf-8")) if plan_path.exists() else None
    return {"cell": cell, "input_sha256": sha256(original / "input.json"),
            "expected_sha256": sha256(original / "expected.jsonl"),
            "raw_sources": sources, "raw_rows": len(rows), "warmup_rows": len(warmup),
            "measured_rows": len(measured), "missing_requests": missing,
            "duplicate_requests": duplicates, "violations": violations,
            "complete": len(measured) == len(warmup) == 600 and missing == 0
                        and not duplicates and not violations,
            "plan_answerable_passed": plans["answerable"]["passed"] if plans else None,
            "metrics": metrics, "scenario": by_scenario, "round": by_round,
            "target_depth": by_depth, "original_model_stats": inputs["stats"]}


def main() -> None:
    frozen = verify()
    available = [cell for cell in cell_names() if (OUT / cell / "raw.csv").exists()
                 or list((OUT / cell).glob("raw-r*.csv"))]
    cells = {cell: audit_cell(cell) for cell in available}
    report = {"scope": "posthoc ordered MySQL membership; original arms unchanged",
              "input_manifest_sha256": sha256(HERE / "input-manifest.json"),
              "expected_cells": frozen["cell_names"], "available_cells": available,
              "complete_cells": sum(row["complete"] for row in cells.values()),
              "measured_attempts": sum(row["measured_rows"] for row in cells.values()),
              "warmup_attempts": sum(row["warmup_rows"] for row in cells.values()),
              "all_plan_guards_passed": all(row["plan_answerable_passed"] is True
                                            for row in cells.values()) if cells else None,
              "cells": cells}
    target = OUT / "analysis.json"
    if target.exists():
        raise FileExistsError("preserve earlier diagnostic audit")
    target.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
                      encoding="utf-8")
    print(json.dumps({"available": len(available), "complete": report["complete_cells"],
                      "measured": report["measured_attempts"],
                      "warmup": report["warmup_attempts"]}))


if __name__ == "__main__":
    main()
