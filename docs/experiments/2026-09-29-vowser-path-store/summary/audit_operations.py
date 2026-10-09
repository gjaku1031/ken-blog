#!/usr/bin/env python3
"""실험 2의 1k·10k 완료 블록만 독립적으로 읽어 감사한다."""

from __future__ import annotations

from collections import defaultdict
import argparse
import csv
import hashlib
import json
from pathlib import Path
import statistics


HERE = Path(__file__).resolve().parent
OPERATIONS = HERE.parent / "operations"
RESULTS = OPERATIONS / "results"
RUNS = OPERATIONS / "runs"
CONDITIONS = (
    ("uniform", 1000, "90_10"), ("uniform", 1000, "50_50"),
    ("uniform", 10000, "90_10"), ("uniform", 10000, "50_50"),
    ("skew", 10000, "90_10"), ("skew", 10000, "50_50"),
)
FINAL_ADDITIONAL_CONDITIONS = (("uniform", 30000, "90_10"), ("uniform", 30000, "50_50"))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def p95(values: list[float]) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * .95
    lower = int(position)
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[min(lower + 1, len(ordered) - 1)] * fraction


def load_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as stream:
        return list(csv.DictReader(stream))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--final", action="store_true", help="30k 두 조건까지 완료된 뒤 전체 48블록 감사")
    args = parser.parse_args()
    conditions = CONDITIONS + FINAL_ADDITIONAL_CONDITIONS if args.final else CONDITIONS
    groups = defaultdict(list)
    source_sha = {}
    official_attempts = 0
    warmup_attempts = 0
    trace_hashes = {}
    oracle_checks = []
    block_records = []
    for distribution, scale, mix in conditions:
        condition = f"{distribution}-{scale}-{mix}"
        final_snapshots = []
        full_snapshots = []
        trace_hashes[condition] = set()
        for backend in ("mysql", "neo4j"):
            for round_index in range(3):
                stem = f"{condition}-{backend}-r{round_index}"
                raw_path = RESULTS / f"raw-{stem}.csv"
                json_path = RESULTS / f"round-{stem}.json"
                exit_path = RUNS / f"round-{stem}.exit"
                assert raw_path.is_file() and json_path.is_file() and exit_path.read_text().strip() == "0", stem
                raw = load_csv(raw_path)
                detail = json.loads(json_path.read_text(encoding="utf-8"))
                assert len(raw) == 200 and {int(row["seq"]) for row in raw} == set(range(200)), stem
                assert all(row["correct"] == "True" and not row["error"] for row in raw), stem
                assert all(row["backend"] == backend and row["distribution"] == distribution and
                           int(row["scale"]) == scale and row["mix"] == mix.replace("_", ":") and
                           int(row["round"]) == round_index for row in raw), stem
                expected = {"90_10": {"popular": 90, "visualize": 90, "register": 10, "update": 10},
                            "50_50": {"popular": 50, "visualize": 50, "register": 10, "update": 90}}[mix]
                counts = {kind: sum(row["kind"] == kind for row in raw) for kind in expected}
                assert counts == expected, (stem, counts)
                assert detail["warmup"]["attempted_ops"] == 200 and detail["warmup"]["raw_rows"] == 0, stem
                assert detail["measured"]["attempted_ops"] == 200 and detail["measured"]["raw_rows"] == 200, stem
                assert detail["initial"] == detail["after_warmup_reset"] == detail["after_round_reset"], stem
                assert detail["warmup_final"] == detail["final"], stem
                assert detail["final"]["counts"]["paths"] == scale, stem
                assert detail["initial"]["counts"]["paths"] == scale - 10, stem
                assert detail["trace_sha256"] == digest(OPERATIONS / "traces" / f"{condition}.jsonl"), stem
                trace_hashes[condition].add(detail["trace_sha256"])
                final_snapshots.append(detail["final"])
                if round_index == 2:
                    assert detail["full_final_validation"] is not None, stem
                    full_snapshots.append(detail["full_final_validation"])
                else:
                    assert detail["full_final_validation"] is None, stem
                for row in raw:
                    groups[(distribution, scale, mix, backend, row["kind"])].append(int(row["latency_ns"]) / 1e6)
                official_attempts += len(raw)
                warmup_attempts += detail["warmup"]["attempted_ops"]
                source_sha[str(raw_path.relative_to(HERE.parent))] = digest(raw_path)
                source_sha[str(json_path.relative_to(HERE.parent))] = digest(json_path)
                block_records.append({"condition": condition, "backend": backend, "round": round_index,
                                      "attempts": len(raw), "warmup_attempts": 200,
                                      "full_validation": round_index == 2,
                                      "reset_matches_initial": True,
                                      "final_matches_warmup_final": True})
        assert len(trace_hashes[condition]) == 1, condition
        assert all(snapshot == final_snapshots[0] for snapshot in final_snapshots), condition
        assert full_snapshots[0] == full_snapshots[1], condition
        oracle_checks.append({"condition": condition, "final_snapshot_match_6_blocks": True,
                              "full_validation_match_2_backends": True,
                              "trace_sha256": next(iter(trace_hashes[condition]))})
    interrupted_json = RESULTS / "interrupted-uniform-10000-50_50-neo4j-r2.json"
    interrupted = json.loads(interrupted_json.read_text(encoding="utf-8"))
    interrupted_raw = RESULTS / interrupted["archived_raw"]
    interrupted_rows = load_csv(interrupted_raw)
    assert not interrupted["official_result"] and interrupted["raw_rows"] == len(interrupted_rows) == 200
    assert interrupted["raw_sha256"] == digest(interrupted_raw)
    assert all(row["correct"] == "True" for row in interrupted_rows)
    assert "SIGTERM exit 143" in interrupted["termination"]
    diagnostic = {}
    diagnostic_info = {}
    for mode in ("source_shape", "optimized"):
        info_path = RESULTS / f"source-diagnostic-{mode}.json"
        raw_path = RESULTS / f"source-diagnostic-{mode}.csv"
        info = json.loads(info_path.read_text(encoding="utf-8"))
        raw = load_csv(raw_path)
        assert len(raw) == 18 and all(row["correct"] == "True" for row in raw)
        assert len(info["rounds"]) == 3
        diagnostic[mode] = {"measured_rows": len(raw), "rounds": 3,
                            "source_sha256": {"json": digest(info_path), "csv": digest(raw_path)},
                            "client_cypher_calls_per_write": info["client_cypher_calls_per_write"]}
        diagnostic_info[mode] = info
    source_shape = diagnostic_info["source_shape"]
    optimized = diagnostic_info["optimized"]
    assert source_shape["seed_full_validation"] == optimized["seed_full_validation"]
    for source_round, optimized_round in zip(source_shape["rounds"], optimized["rounds"]):
        assert source_round["final"] == optimized_round["final"]
        assert source_round["after_reset"] == optimized_round["after_reset"]
    metrics = []
    for (distribution, scale, mix, backend, kind), values in sorted(groups.items()):
        metrics.append({"distribution": distribution, "scale": scale, "mix": mix.replace("_", ":"),
                        "backend": backend, "operation": kind, "attempts": len(values),
                        "median_ms": statistics.median(values), "p95_ms_type7": p95(values)})
    expected = 9600 if args.final else 7200
    assert len(metrics) == (64 if args.final else 48) and official_attempts == warmup_attempts == expected
    output = {"scope": "final read-only independent audit of all eight operations conditions" if args.final else
              "interim read-only independent audit of completed 1k/10k operations blocks; 30k excluded",
              "official_blocks": len(block_records), "official_attempts": official_attempts,
              "official_request_errors_or_timeouts": 0, "warmup_attempts": warmup_attempts,
              "warmup_raw_rows": 0, "all_reset_and_full_oracles_pass": True,
              "oracle_checks": oracle_checks, "blocks": block_records,
              "interrupted_extra_attempts_not_official": len(interrupted_rows),
              "interrupted_termination": interrupted["termination"],
              "diagnostic_extra_attempts_not_official": sum(item["measured_rows"] for item in diagnostic.values()),
              "source_diagnostic": diagnostic, "source_diagnostic_final_and_reset_match": True,
              "metrics": metrics,
              "raw_and_round_sha256": source_sha,
              "latency_method": "CSV latency_ns / 1e6; Python statistics.median and sorted linear type-7 p95; successful official requests only"}
    suffix = "final" if args.final else "interim"
    json_path = HERE / f"operations-audit-{suffix}.json"
    csv_path = HERE / f"operations-audit-{suffix}.csv"
    json_path.write_text(json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    with csv_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(metrics[0]))
        writer.writeheader()
        writer.writerows(metrics)
    print(json.dumps({"status": "audited", "official_attempts": official_attempts,
                      "warmup_attempts": warmup_attempts, "interrupted_extra": len(interrupted_rows),
                      "diagnostic_extra": output["diagnostic_extra_attempts_not_official"],
                      "metrics": len(metrics)}, sort_keys=True))


if __name__ == "__main__":
    main()
