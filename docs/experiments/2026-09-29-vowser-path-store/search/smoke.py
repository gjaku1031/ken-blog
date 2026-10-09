#!/usr/bin/env python3
"""본측정 전 1k 스모크: 점수·반환 필드·깊이·DB 호출을 검증한다."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

import numpy as np
import psutil

from shared.data import path_record
from search.build_inputs import ASSETS, validate as validate_inputs
from search.build_oracle import validate as validate_oracle
from search.search_adapters import MysqlFaissSearch, NeoSearch

HERE = Path(__file__).resolve().parent
SMOKES = HERE / "smoke"
QUERY_IDS = (0, 1, 10, 17, 39, 70, 100, 155, 180, 199)
ABS_SCORE_TOLERANCE = 1e-4


def assert_path(path: dict, path_id: int, score: float, distribution: str) -> None:
    source = path_record(path_id, distribution)
    expected = {
        "domain": source["domain"], "taskIntent": source["intent"],
        "relevance_score": round(score, 3), "weight": 1,
        "steps": [{
            "order": item["ordinal"], "url": item["url"], "action": item["action"],
            "selectors": item["selectors"], "description": item["description"],
            "isInput": item["isInput"], "inputType": None,
            "inputPlaceholder": None, "shouldWait": item["shouldWait"],
            "waitMessage": None, "textLabels": item["textLabels"],
        } for item in source["steps"]],
    }
    if path != expected:
        raise AssertionError(f"full path payload mismatch: {path_id}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("neo", "mysql"), required=True)
    parser.add_argument("--distribution", choices=("uniform", "skew"), default="uniform")
    parser.add_argument("--n", type=int, choices=(1000, 10000, 30000), default=1000)
    parser.add_argument("--label", required=True)
    args = parser.parse_args()
    validate_inputs()
    validate_oracle()
    SMOKES.mkdir(exist_ok=True)
    output = SMOKES / f"{args.label}.json"
    if output.exists():
        raise RuntimeError(f"smoke record exists: {output}")
    vectors = np.load(ASSETS / f"paths_{args.distribution}.npy", mmap_mode="r")
    queries = np.load(ASSETS / f"queries_{args.distribution}.npy", mmap_mode="r")
    metadata = [json.loads(line) for line in (ASSETS / f"queries_{args.distribution}.jsonl").read_text(encoding="utf-8").splitlines()]
    oracle = {item["query_id"]: item for item in (json.loads(line) for line in (ASSETS / f"oracle_{args.distribution}_{args.n}.jsonl").read_text(encoding="utf-8").splitlines())}
    rss_before = psutil.Process().memory_info().rss
    adapter = NeoSearch() if args.backend == "neo" else MysqlFaissSearch(args.n)
    rss_after_init = psutil.Process().memory_info().rss
    records, failures = [], []
    try:
        for qid in QUERY_IDS:
            query = np.asarray(queries[qid], dtype=np.float32)
            for hint in (False, True):
                domain = f"d{metadata[qid]['domain_id']:02d}.example.test" if hint else None
                for limit in (3, 10):
                    arms = ("neo_original", "neo_optimized") if args.backend == "neo" else ("mysql_faiss",)
                    for arm in arms:
                        target = oracle[qid]["hint" if hint else "no_hint"][:limit]
                        started = time.perf_counter_ns()
                        item = {"query_id": qid, "hint": hint, "limit": limit, "arm": arm, "oracle_ids": [x["path_id"] for x in target]}
                        try:
                            if arm == "neo_original":
                                result = adapter.original(query, limit, domain)
                            elif arm == "neo_optimized":
                                result = adapter.optimized(query, limit, domain, candidate_k=limit * 12)
                            else:
                                result = adapter.search(query, limit, metadata[qid]["domain_id"] if hint else None, candidate_k=limit * 12)
                            if len(result["path_ids"]) != len(result["payload"]["matched_paths"]):
                                raise AssertionError("path id count differs from JSON payload")
                            for pid, score, path in zip(result["path_ids"], result["raw_scores"], result["payload"]["matched_paths"]):
                                raw_dot = float(np.dot(query, vectors[pid]))
                                if abs(score - raw_dot) > ABS_SCORE_TOLERANCE:
                                    raise AssertionError(f"raw cosine delta exceeds {ABS_SCORE_TOLERANCE}: {pid}, {score}, {raw_dot}")
                                if score <= 0.3:
                                    raise AssertionError(f"returned ineligible score: {pid}")
                                if hint and path_record(pid, args.distribution)["domain"] != domain:
                                    raise AssertionError(f"domain mismatch: {pid}")
                                assert_path(path, pid, score, args.distribution)
                            if arm == "neo_optimized" and hint and result["path_ids"] != [x["path_id"] for x in target]:
                                raise AssertionError("optimized exact domain path order differs from oracle")
                            item.update({"ok": True, "path_ids": result["path_ids"], "db_roundtrips": result["db_roundtrips"], "elapsed_ms": result["elapsed_ms"], "json_bytes": result["json_bytes"]})
                        except Exception as error:
                            item.update({"ok": False, "error_type": type(error).__name__, "error": str(error)[:500]})
                            failures.append(item)
                        item["harness_wall_ms"] = round((time.perf_counter_ns() - started) / 1_000_000, 3)
                        records.append(item)
    finally:
        adapter.close()
    result = {"backend": args.backend, "distribution": args.distribution, "n": args.n, "query_ids": QUERY_IDS, "requests": len(records), "failure_count": len(failures), "rss_before_bytes": rss_before, "rss_after_init_bytes": rss_after_init, "rss_end_bytes": psutil.Process().memory_info().rss, "faiss_index_build_ms": getattr(adapter, "index_build_ms", None), "records": records}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "records"}, ensure_ascii=False, sort_keys=True))
    if failures:
        print(json.dumps({"first_failures": failures[:3]}, ensure_ascii=False))
        raise RuntimeError(f"{len(failures)} smoke failures; see {output}")


if __name__ == "__main__":
    main()
