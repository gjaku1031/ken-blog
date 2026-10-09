#!/usr/bin/env python3
"""1k에서 원본형 독립 graph.query와 단일 Cypher 쓰기를 별도 비교."""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

from shared.data import path_record
from operations.runner import RESULTS, full_validate, light_validate
from operations.stores import Neo4jSourceShapeStore, Neo4jStore, root_counts


def run(mode):
    store = Neo4jSourceShapeStore() if mode == "source_shape" else Neo4jStore()
    scale = 1000
    initial = 990
    new_ids = (990, 991, 992)  # 깊이 5/10/20 각각 1개
    updated_ids = (0, 1, 2)
    records = {i: path_record(i, "uniform") for i in new_ids}
    visits = {r["domain"]: r["visitCount"] for r in root_counts(initial, "uniform")}
    for path_id in (*new_ids, *updated_ids):
        visits[path_record(path_id, "uniform")["domain"]] += 1
    weights = {i: 2 for i in updated_ids}
    roots = root_counts(initial, "uniform")
    rows = []
    rounds = []
    try:
        store.initialize()
        store.seed(initial, "uniform")
        seed_full = full_validate(store, initial, "uniform")
        for round_number in range(3):
            for timed in (False, True):
                for kind, ids in (("register", new_ids), ("update", updated_ids)):
                    for path_id in ids:
                        started = time.perf_counter_ns()
                        if kind == "register":
                            store.register(records[path_id])
                        else:
                            store.update(path_id)
                        elapsed = time.perf_counter_ns() - started
                        if timed:
                            rows.append({"mode": mode, "round": round_number,
                                         "kind": kind, "path_id": path_id,
                                         "depth": path_record(path_id, "uniform")["depth"],
                                         "latency_ns": elapsed, "correct": True})
                validation = light_validate(store, scale - 7, "uniform", weights, visits,
                                            set((*new_ids, *updated_ids)))
                # 등록은 3개만이므로 prefix 기반 검증 대신 개별 상태/합계 검사.
                assert validation["counts"]["paths"] == initial + len(new_ids)
                store.reset(new_ids, updated_ids, roots)
                reset = light_validate(store, initial, "uniform")
                if timed:
                    rounds.append({"round": round_number, "final": validation,
                                   "after_reset": reset})
        RESULTS.mkdir(exist_ok=True)
        raw_path = RESULTS / f"source-diagnostic-{mode}.csv"
        with raw_path.open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=("mode", "round", "kind",
                                                       "path_id", "depth", "latency_ns", "correct"))
            writer.writeheader()
            writer.writerows(rows)
        (RESULTS / f"source-diagnostic-{mode}.json").write_text(json.dumps({
            "scope": "Neo4j only, 1k initial fixture, three depths, outside main engine comparison",
            "mode": mode, "seed_full_validation": seed_full,
            "rounds": rounds, "raw_csv": str(raw_path.name),
            "client_cypher_calls_per_write": ("2*depth+3" if mode == "source_shape" else "1"),
        }, ensure_ascii=False, indent=2) + "\n")
    finally:
        store.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("source_shape", "optimized"), required=True)
    args = parser.parse_args()
    run(args.mode)
