#!/usr/bin/env python3
"""저장된 원시 CSV/JSON만 사용한 운영 실험 사후 감사와 층별 집계."""

from __future__ import annotations

import csv
import hashlib
import json
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"


def quantile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = fraction * (len(ordered) - 1)
    lower = int(position)
    return ordered[lower] + (ordered[min(lower + 1, len(ordered) - 1)] - ordered[lower]) * (position - lower)


def metrics(rows: list[dict]) -> dict:
    durations = [int(row["latency_ns"]) / 1_000_000 for row in rows]
    return {"n": len(rows), "failures": sum(row["correct"] != "True" for row in rows),
            "p50_ms": statistics.median(durations), "p95_ms": quantile(durations, 0.95)}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    manifest = json.loads((HERE / "trace_manifest.json").read_text())
    trace_checks = []
    for entry in manifest["traces"]:
        trace_checks.append({"condition": entry["condition"],
                             "trace_match": sha(HERE / entry["trace"]) == entry["trace_sha256"],
                             "oracle_match": sha(HERE / entry["oracle"]) == entry["oracle_sha256"]})
    trace_ok = all(item["trace_match"] and item["oracle_match"] for item in trace_checks)
    assert sha(HERE.parent / "shared" / "data.py") == manifest["shared_data_sha256"]
    assert sha(HERE / "trace.py") == manifest["trace_generator_sha256"]

    blocks = []
    by_round_kind = defaultdict(list)
    by_stratum = defaultdict(list)
    by_composition = defaultdict(list)
    all_rows = []
    paired_final = defaultdict(dict)
    for path in sorted(RESULTS.glob("round-*-r[012].json")):
        record = json.loads(path.read_text())
        key = (record["scale"], record["distribution"], record["mix"], record["round"])
        backend = record["backend"]
        stem = f"{record['distribution']}-{record['scale']}-{record['mix'].replace(':', '_')}-{backend}-r{record['round']}"
        raw_path = RESULTS / f"raw-{stem}.csv"
        with raw_path.open(newline="") as stream:
            rows = list(csv.DictReader(stream))
        expected_initial = int(record["scale"]) - 10
        assert len(rows) == 200 == record["measured"]["raw_rows"]
        assert all(row["correct"] == "True" and row["error"] == "" for row in rows)
        assert record["initial"]["counts"]["paths"] == expected_initial
        assert record["after_warmup_reset"]["counts"]["paths"] == expected_initial
        assert record["final"]["counts"]["paths"] == int(record["scale"])
        assert record["after_round_reset"]["counts"]["paths"] == expected_initial
        assert record["initial"]["weight_sha256"] == record["after_warmup_reset"]["weight_sha256"]
        assert record["initial"]["weight_sha256"] == record["after_round_reset"]["weight_sha256"]
        assert record["warmup"]["attempted_ops"] == 200
        paired_final[key][backend] = {
            "light": record["final"],
            "full": record["full_final_validation"],
        }
        item = {"scale": record["scale"], "distribution": record["distribution"],
                "mix": record["mix"], "round": record["round"], "backend": backend,
                "raw_file": raw_path.name, "raw_sha256": sha(raw_path),
                "wall_seconds": record["measured"]["wall_seconds"],
                "sequential_ops_per_second": 200 / record["measured"]["wall_seconds"],
                "warmup_ops": record["warmup"]["attempted_ops"], "timed_ops": len(rows),
                "correct_ops": sum(row["correct"] == "True" for row in rows)}
        blocks.append(item)
        all_rows.extend(rows)
        for row in rows:
            group = (row["scale"], row["distribution"], row["mix"], row["backend"], row["round"], row["kind"])
            by_round_kind[group].append(row)
            if row["kind"] == "visualize":
                valid = int(row["valid_paths"])
                null = int(row["null_paths"])
                assert valid + null == int(row["rows"])
                stratum = "all_valid" if null == 0 else "all_null" if valid == 0 else "mixed"
                by_stratum[(row["scale"], row["distribution"], row["mix"], row["backend"], stratum)].append(row)
                by_composition[(row["scale"], row["distribution"], row["mix"], row["backend"], valid, null)].append(row)

    assert len(blocks) == 48 and len(all_rows) == 9600
    assert len(paired_final) == 24
    assert all(pair["mysql"]["light"] == pair["neo4j"]["light"]
               for pair in paired_final.values())
    full_pairs = [pair for (scale, distribution, mix, round_number), pair in paired_final.items()
                  if round_number == 2]
    assert len(full_pairs) == 8
    assert all(pair["mysql"]["full"] is not None and
               pair["mysql"]["full"] == pair["neo4j"]["full"] for pair in full_pairs)
    assert all(pair["mysql"]["full"] is None and pair["neo4j"]["full"] is None
               for (scale, distribution, mix, round_number), pair in paired_final.items()
               if round_number != 2)
    interrupted = RESULTS / "interrupted-uniform-10000-50_50-neo4j-r2.csv"
    with interrupted.open(newline="") as stream:
        interrupted_rows = list(csv.DictReader(stream))
    assert len(interrupted_rows) == 200
    assert all(row["correct"] == "True" for row in interrupted_rows)

    official_summary = json.loads((RESULTS / "summary.json").read_text())
    by_condition_kind = defaultdict(list)
    for row in all_rows:
        by_condition_kind[(int(row["scale"]), row["distribution"], row["mix"],
                           row["backend"], row["kind"])].append(row)
    assert len(official_summary) == len(by_condition_kind) == 64
    for item in official_summary:
        key = (item["scale"], item["distribution"], item["mix"], item["backend"], item["kind"])
        actual = metrics(by_condition_kind[key])
        assert item["n"] == actual["n"] and item["failures"] == actual["failures"]
        assert abs(item["p50_ms"] - actual["p50_ms"]) < 1e-9
        assert abs(item["p95_ms"] - actual["p95_ms"]) < 1e-9
    official_throughput = json.loads((RESULTS / "throughput.json").read_text())
    measured_blocks = {(x["scale"], x["distribution"], x["mix"], x["backend"], x["round"]): x
                       for x in blocks}
    assert len(official_throughput) == len(measured_blocks) == 48
    for item in official_throughput:
        key = (item["scale"], item["distribution"], item["mix"], item["backend"], item["round"])
        block = measured_blocks[key]
        assert item["operations"] == block["timed_ops"] == 200
        assert abs(item["wall_seconds"] - block["wall_seconds"]) < 1e-9
        assert abs(item["sequential_ops_per_second"] - block["sequential_ops_per_second"]) < 1e-9

    round_metrics = []
    for key, rows in sorted(by_round_kind.items()):
        round_metrics.append(dict(zip(("scale", "distribution", "mix", "backend", "round", "kind"),
                                      (int(key[0]), *key[1:])), **metrics(rows)))
    strata = []
    for key, rows in sorted(by_stratum.items()):
        item = dict(zip(("scale", "distribution", "mix", "backend", "stratum"),
                        (int(key[0]), *key[1:])))
        item.update(metrics(rows))
        item["valid_path_rows"] = sum(int(row["valid_paths"]) for row in rows)
        item["null_path_rows"] = sum(int(row["null_paths"]) for row in rows)
        strata.append(item)

    diagnostic = {}
    for mode in ("source_shape", "optimized"):
        with (RESULTS / f"source-diagnostic-{mode}.csv").open(newline="") as stream:
            rows = list(csv.DictReader(stream))
        assert len(rows) == 18 and all(row["correct"] == "True" for row in rows)
        diagnostic[mode] = {kind: metrics([row for row in rows if row["kind"] == kind])
                            for kind in ("register", "update")}

    smoke_passes = 0
    for backend in ("mysql", "neo4j"):
        log = HERE / "runs" / f"smoke-uniform-1000-90_10-{backend}-r0.log"
        smoke_passes += log.read_text().count(f"smoke passed {backend}: 200 operations")
    assert smoke_passes == 4

    audit = {"utc": datetime.now(timezone.utc).isoformat(), "trace_checks": trace_checks,
             "trace_checks_all_pass": trace_ok, "official_blocks": len(blocks),
             "official_timed_attempts": len(all_rows), "official_failures": 0,
             "official_warmup_attempts": sum(x["warmup_ops"] for x in blocks),
             "published_64_operation_groups_recomputed_equal": True,
             "published_48_throughput_blocks_recomputed_equal": True,
             "interrupted_warmup_attempts_before_archived_timed_csv": 200,
             "smoke_untimed_attempts_from_four_pass_logs": smoke_passes * 200,
             "source_diagnostic_untimed_warmup_writes": 36,
             "paired_final_light_state_equal_blocks": 24,
             "paired_final_full_payload_equal_condition_last_rounds": len(full_pairs),
             "interrupted_timed_attempts_excluded_from_official": len(interrupted_rows),
             "interrupted_correct_raw_rows": sum(row["correct"] == "True" for row in interrupted_rows),
             "source_diagnostic_timed_writes_per_mode": 18,
             "total_known_timed_attempts_including_interrupted_and_diagnostic":
                 len(all_rows) + len(interrupted_rows) + 36,
             "blocks": blocks, "source_diagnostic": diagnostic}
    (RESULTS / "audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n")
    (RESULTS / "per-round-metrics.json").write_text(json.dumps(round_metrics, ensure_ascii=False, indent=2) + "\n")
    (RESULTS / "visualize-strata.json").write_text(json.dumps(strata, ensure_ascii=False, indent=2) + "\n")
    composition = []
    for key, rows in sorted(by_composition.items()):
        item = dict(zip(("scale", "distribution", "mix", "backend", "valid_paths", "null_paths"),
                        (int(key[0]), *key[1:4], int(key[4]), int(key[5]))))
        item.update(metrics(rows))
        composition.append(item)
    (RESULTS / "visualize-composition.json").write_text(json.dumps(composition, ensure_ascii=False, indent=2) + "\n")
    print(f"PASS {len(blocks)} blocks, {len(all_rows)} official timed, "
          f"{sum(x['warmup_ops'] for x in blocks)} warmup, {len(interrupted_rows)} interrupted")


if __name__ == "__main__":
    main()
