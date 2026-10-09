#!/usr/bin/env python3
"""실험 2 fixture, oracle, warmup/reset 및 원시 지연 기록 CLI."""

from __future__ import annotations

import argparse
import csv
import hashlib
import itertools
import json
import statistics
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import psutil

from shared.data import DEPTHS, SCALES, domain_id, path_record
from operations.stores import MySQLStore, Neo4jStore, root_counts, step_rows

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
TRACES = HERE / "traces"


def make_store(backend):
    return MySQLStore() if backend == "mysql" else Neo4jStore()


def expected_rows(kind, total, distribution, weights, visits):
    if kind == "root":
        for domain in sorted(visits):
            yield {"domain": domain, "baseURL": f"https://{domain}",
                   "visitCount": visits[domain]}
        return
    for path_id in range(total):
        record = path_record(path_id, distribution)
        weight = weights.get(path_id, 1)
        if kind == "has":
            yield {"pathId": path_id, "domain": record["domain"],
                   "firstStepId": record["steps"][0]["step_id"],
                   "taskIntent": record["intent"], "weight": weight}
        elif kind == "step":
            for step in step_rows(record):
                step["usageCount"] = weight
                yield step
        else:
            for ordinal in range(1, len(record["steps"])):
                yield {"pathId": path_id, "sequenceOrder": ordinal,
                       "fromId": record["steps"][ordinal - 1]["step_id"],
                       "toId": record["steps"][ordinal]["step_id"],
                       "weight": weight}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), default=str)


def full_validate(store, total, distribution, weights=None, visits=None):
    """ROOT/HAS/STEP/NEXT 전체 payload의 결정적 순서 readback."""
    weights = weights or {}
    visits = visits or {r["domain"]: r["visitCount"] for r in root_counts(total, distribution)}
    results = {}
    for kind in ("root", "has", "step", "edge"):
        digest = hashlib.sha256()
        count = 0
        actual_rows = store.iter_rows(kind)
        expected = expected_rows(kind, total, distribution, weights, visits)
        for count, (actual, wanted) in enumerate(itertools.zip_longest(actual_rows, expected), 1):
            if actual != wanted:
                raise AssertionError(f"{store.name} {kind} row {count} mismatch: "
                                     f"actual={str(actual)[:240]} expected={str(wanted)[:240]}")
            digest.update((canonical(actual) + "\n").encode())
        results[kind] = {"rows": count, "sha256": digest.hexdigest()}
    return results


def expected_counts(total):
    return {"roots": 30, "paths": total,
            "steps": sum(DEPTHS[i % 3] + 1 for i in range(total)),
            "edges": sum(DEPTHS[i % 3] for i in range(total))}


def expected_weight_hash(total, weights):
    return hashlib.sha256("".join(
        f"{i}:{weights.get(i, 1)}\n" for i in range(total)).encode()).hexdigest()


def light_validate(store, total, distribution, weights=None, visits=None, touched=None):
    weights = weights or {}
    visits = visits or {r["domain"]: r["visitCount"] for r in root_counts(total, distribution)}
    counts = store.counts()
    if counts != expected_counts(total):
        raise AssertionError(f"{store.name} count mismatch {counts} != {expected_counts(total)}")
    root_actual = store.root_visits()
    if root_actual != visits:
        raise AssertionError(f"{store.name} root visit counts mismatch")
    actual_weights = store.weights()
    if len(actual_weights) != total:
        raise AssertionError(f"{store.name} weight row count mismatch")
    digest = hashlib.sha256()
    for expected_path_id, (path_id, weight) in enumerate(actual_weights):
        if path_id != expected_path_id or weight != weights.get(path_id, 1):
            raise AssertionError(f"{store.name} weight mismatch path={expected_path_id}")
        digest.update(f"{path_id}:{weight}\n".encode())
    if digest.hexdigest() != expected_weight_hash(total, weights):
        raise AssertionError(f"{store.name} weight checksum mismatch")
    touched_rows = store.touched_state(touched or set())
    for key, actual in touched_rows.items():
        path_id = int(key)
        weight = weights.get(path_id, 1)
        wanted = {"has_weight": weight,
                  "step": (weight, weight, DEPTHS[path_id % 3] + 1),
                  "edge": (weight, weight, DEPTHS[path_id % 3])}
        if actual != wanted:
            raise AssertionError(f"{store.name} touched path {path_id}: {actual} != {wanted}")
    return {"counts": counts, "weight_sha256": digest.hexdigest(),
            "root_visits": root_actual, "touched": touched_rows}


def load_trace(scale, mix, distribution):
    stem = f"{distribution}-{scale}-{mix.replace(':', '_')}"
    lines = (TRACES / f"{stem}.jsonl").read_text().splitlines()
    ops = [json.loads(line) for line in lines]
    oracle = json.loads((TRACES / f"{stem}-oracle.json").read_text())
    return stem, ops, oracle


def execute_op(store, op, records):
    kind = op["kind"]
    if kind == "register":
        store.register(records[op["path_id"]])
        return None
    if kind == "update":
        store.update(op["path_id"])
        return None
    if kind == "popular":
        return store.popular(op["domain"])
    return store.visualize(op["domain"])


def call_counts(backend, kind, result):
    """서버 문장 수와 클라이언트 commit 호출을 분리한 고정 작업 계약."""
    if backend == "neo4j":
        return {"driver_query_calls": 1, "server_statements": 1,
                "stored_proc_inner": 0, "commit_calls": 0,
                "auto_commit_transactions": 1}
    if kind == "register":
        return {"driver_query_calls": 4, "server_statements": 4,
                "stored_proc_inner": 0, "commit_calls": 1,
                "auto_commit_transactions": 0}
    if kind == "update":
        return {"driver_query_calls": 1, "server_statements": 5,
                "stored_proc_inner": 4, "commit_calls": 1,
                "auto_commit_transactions": 0}
    queries = 2 if kind == "visualize" and any(
        row["steps"] is not None for row in result) else 1
    return {"driver_query_calls": queries, "server_statements": queries,
            "stored_proc_inner": 0, "commit_calls": 0,
            "auto_commit_transactions": 0}


def execute_trace(store, ops, records, *, timed, csv_path=None, scale=None,
                  mix=None, distribution=None, round_number=None):
    raw = []
    start_wall = time.perf_counter()
    for op in ops:
        start = time.perf_counter_ns()
        try:
            result = execute_op(store, op, records)
        except Exception as exc:
            elapsed = time.perf_counter_ns() - start
            if timed:
                raw.append({"scale": scale, "distribution": distribution,
                            "mix": mix, "backend": store.name, "round": round_number,
                            "seq": op["seq"], "kind": op["kind"], "latency_ns": elapsed,
                            "correct": False, "rows": None, "valid_paths": None,
                            "null_paths": None, "error": f"{type(exc).__name__}: {exc}",
                            **{key: None for key in call_counts("neo4j", "popular", []).keys()}})
                if csv_path:
                    write_raw(csv_path, raw)
            raise
        elapsed = time.perf_counter_ns() - start
        if "expected" in op and result != op["expected"]:
            if timed:
                raw.append({"scale": scale, "distribution": distribution,
                            "mix": mix, "backend": store.name, "round": round_number,
                            "seq": op["seq"], "kind": op["kind"], "latency_ns": elapsed,
                            "correct": False, "rows": len(result or []),
                            "valid_paths": None, "null_paths": None,
                            "error": "oracle_mismatch",
                            **call_counts(store.name, op["kind"], result)})
                if csv_path:
                    write_raw(csv_path, raw)
            raise AssertionError(f"{store.name} {op['kind']} seq={op['seq']} differs from oracle; "
                                 f"actual={str(result)[:300]} expected={str(op['expected'])[:300]}")
        if timed:
            valid = sum(row["steps"] is not None for row in result) if op["kind"] == "visualize" else None
            null = sum(row["steps"] is None for row in result) if op["kind"] == "visualize" else None
            raw.append({"scale": scale, "distribution": distribution,
                        "mix": mix, "backend": store.name, "round": round_number,
                        "seq": op["seq"], "kind": op["kind"], "latency_ns": elapsed,
                        "correct": True, "rows": len(result or []),
                        "valid_paths": valid, "null_paths": null, "error": "",
                        **call_counts(store.name, op["kind"], result)})
    wall = time.perf_counter() - start_wall
    if timed and csv_path:
        write_raw(csv_path, raw)
    return {"wall_seconds": wall, "attempted_ops": len(ops), "raw_rows": len(raw)}


def write_raw(path, rows):
    path.parent.mkdir(exist_ok=True)
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=("scale", "distribution", "mix", "backend",
                                                   "round", "seq", "kind", "latency_ns",
                                                   "correct", "rows", "valid_paths", "null_paths",
                                                   "error", "driver_query_calls", "server_statements",
                                                   "stored_proc_inner", "commit_calls",
                                                   "auto_commit_transactions"))
        writer.writeheader()
        writer.writerows(rows)


def prepare(store, scale, distribution):
    initial = scale - 10
    started = time.perf_counter()
    store.initialize()
    store.seed(initial, distribution)
    validation = full_validate(store, initial, distribution)
    light = light_validate(store, initial, distribution)
    result = {"backend": store.name, "scale_final": scale, "scale_initial": initial,
              "distribution": distribution, "setup_seconds": time.perf_counter() - started,
              "full_validation": validation, "light_validation": light}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"seed-{distribution}-{scale}-{store.name}.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"prepared {store.name} {distribution} final={scale} initial={initial}")


def run_smoke(store):
    """1k / 90:10 전체 trace의 비측정 정합 및 원상 복구."""
    scale, mix, distribution = 1000, "90:10", "uniform"
    stem, ops, oracle = load_trace(scale, mix, distribution)
    initial = scale - 10
    new_ids = list(range(initial, scale))
    updated_ids = sorted({op["path_id"] for op in ops if op["kind"] == "update"})
    touched = set(new_ids) | set(updated_ids)
    roots = root_counts(initial, distribution)
    final_visits = {f"d{int(did):02d}.example.test": value
                    for did, value in oracle["final_root_visit_count"].items()}
    final_weights = {int(path_id): weight for path_id, weight in oracle["updated_path_weights"].items()}
    records = {path_id: path_record(path_id, distribution) for path_id in new_ids}
    before = light_validate(store, initial, distribution)
    executed = execute_trace(store, ops, records, timed=False)
    final = light_validate(store, scale, distribution, final_weights, final_visits, touched)
    full = full_validate(store, scale, distribution, final_weights, final_visits)
    store.reset(new_ids, updated_ids, roots)
    after_reset = light_validate(store, initial, distribution)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"smoke-{store.name}.json").write_text(json.dumps({
        "backend": store.name, "trace": stem, "before": before,
        "executed": executed, "final": final, "full_final": full,
        "after_reset": after_reset,
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"smoke passed {store.name}: {len(ops)} operations, full payload and reset")


def run_round(store, scale, mix, distribution, round_number):
    stem, ops, oracle = load_trace(scale, mix, distribution)
    initial = scale - 10
    new_ids = list(range(initial, scale))
    updated_ids = sorted({op["path_id"] for op in ops if op["kind"] == "update"})
    touched = set(updated_ids) | set(new_ids)
    roots = root_counts(initial, distribution)
    base_visits = {r["domain"]: r["visitCount"] for r in roots}
    final_visits = {f"d{int(did):02d}.example.test": value
                    for did, value in oracle["final_root_visit_count"].items()}
    final_weights = {int(path_id): weight for path_id, weight in oracle["updated_path_weights"].items()}
    register_records = {path_id: path_record(path_id, distribution) for path_id in new_ids}
    before = light_validate(store, initial, distribution)
    warmup = execute_trace(store, ops, register_records, timed=False)
    warmup_final = light_validate(store, scale, distribution,
                                  final_weights, final_visits, touched)
    store.reset(new_ids, updated_ids, roots)
    after_warmup_reset = light_validate(store, initial, distribution)
    raw_path = RESULTS / f"raw-{stem}-{store.name}-r{round_number}.csv"
    process = psutil.Process()
    cpu_before = sum(process.cpu_times()[:2])
    rss_before = process.memory_info().rss
    measured = execute_trace(store, ops, register_records, timed=True,
                             csv_path=raw_path, scale=scale, mix=mix,
                             distribution=distribution, round_number=round_number)
    cpu_after = sum(process.cpu_times()[:2])
    rss_after = process.memory_info().rss
    after = light_validate(store, scale, distribution,
                           final_weights, final_visits, touched)
    if round_number == 2:
        full = full_validate(store, scale, distribution, final_weights, final_visits)
    else:
        full = None
    summary = {
        "backend": store.name, "scale": scale, "mix": mix,
        "distribution": distribution, "round": round_number,
        "trace_sha256": hashlib.sha256((TRACES / f"{stem}.jsonl").read_bytes()).hexdigest(),
        "initial": before, "warmup": warmup, "warmup_final": warmup_final,
        "after_warmup_reset": after_warmup_reset,
        "measured": measured, "final": after, "full_final_validation": full,
        "worker_cpu_seconds_measured_delta": cpu_after - cpu_before,
        "worker_rss_bytes_before_measured": rss_before,
        "worker_rss_bytes_after_measured": rss_after,
    }
    store.reset(new_ids, updated_ids, roots)
    summary["after_round_reset"] = light_validate(store, initial, distribution)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"round-{stem}-{store.name}-r{round_number}.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(f"round complete {stem} {store.name} r{round_number}: {measured['wall_seconds']:.3f}s")


def summarize():
    rows = []
    for path in sorted(RESULTS.glob("raw-*.csv")):
        with path.open() as stream:
            rows.extend(csv.DictReader(stream))
    groups = {}
    failures = {}
    for row in rows:
        key = (row["scale"], row["distribution"], row["mix"], row["backend"], row["kind"])
        if row["correct"] != "True":
            failures[key] = failures.get(key, 0) + 1
            continue
        groups.setdefault(key, []).append(int(row["latency_ns"]) / 1e6)
    summary = []
    for key in sorted(set(groups) | set(failures)):
        values = groups.get(key, [])
        if not values:
            summary.append({"scale": int(key[0]), "distribution": key[1], "mix": key[2],
                            "backend": key[3], "kind": key[4], "n": 0,
                            "failures": failures[key], "p50_ms": None, "p95_ms": None})
            continue
        ordered = sorted(values)
        p95_index = 0.95 * (len(ordered) - 1)
        lower = int(p95_index)
        p95 = ordered[lower] + (ordered[min(lower + 1, len(ordered) - 1)] - ordered[lower]) * (p95_index - lower)
        summary.append({"scale": int(key[0]), "distribution": key[1], "mix": key[2],
                        "backend": key[3], "kind": key[4], "n": len(values),
                        "failures": failures.get(key, 0),
                        "p50_ms": statistics.median(ordered), "p95_ms": p95})
    (RESULTS / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    throughput = []
    for path in sorted(RESULTS.glob("round-*.json")):
        record = json.loads(path.read_text())
        measured = record["measured"]
        throughput.append({"scale": record["scale"], "distribution": record["distribution"],
                           "mix": record["mix"], "backend": record["backend"],
                           "round": record["round"], "operations": measured["raw_rows"],
                           "wall_seconds": measured["wall_seconds"],
                           "sequential_ops_per_second": measured["raw_rows"] / measured["wall_seconds"]})
    (RESULTS / "throughput.json").write_text(json.dumps(throughput, ensure_ascii=False, indent=2) + "\n")
    print(f"summarized {len(rows)} operations into {len(summary)} groups, "
          f"{len(throughput)} complete round files")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("prepare", "smoke", "round", "validate", "summarize"))
    parser.add_argument("--backend", choices=("mysql", "neo4j"))
    parser.add_argument("--scale", type=int, choices=SCALES)
    parser.add_argument("--mix", choices=("90:10", "50:50"))
    parser.add_argument("--distribution", choices=("uniform", "skew"), default="uniform")
    parser.add_argument("--round", type=int, choices=(0, 1, 2))
    args = parser.parse_args()
    if args.command == "summarize":
        summarize()
        return
    if args.backend is None or args.scale is None:
        parser.error("--backend and --scale are required")
    store = make_store(args.backend)
    try:
        if args.command == "prepare":
            prepare(store, args.scale, args.distribution)
        elif args.command == "smoke":
            if args.scale != 1000 or args.distribution != "uniform":
                parser.error("smoke requires --scale 1000 --distribution uniform")
            run_smoke(store)
        elif args.command == "validate":
            print(json.dumps(light_validate(store, args.scale - 10, args.distribution), ensure_ascii=False))
        else:
            if args.mix is None or args.round is None:
                parser.error("round requires --mix and --round")
            try:
                run_round(store, args.scale, args.mix, args.distribution, args.round)
            except Exception as exc:
                RESULTS.mkdir(exist_ok=True)
                stem = f"{args.distribution}-{args.scale}-{args.mix.replace(':', '_')}"
                path = RESULTS / f"failure-{stem}-{store.name}-r{args.round}.json"
                path.write_text(json.dumps({
                    "time_utc": datetime.now(timezone.utc).isoformat(),
                    "backend": store.name, "scale": args.scale,
                    "mix": args.mix, "distribution": args.distribution,
                    "round": args.round, "error": f"{type(exc).__name__}: {exc}",
                    "traceback": traceback.format_exc(),
                    "note": "부분 변경 상태가 남을 수 있으므로 재시도 전 prepare 필요",
                }, ensure_ascii=False, indent=2) + "\n")
                raise
    finally:
        store.close()


if __name__ == "__main__":
    main()
