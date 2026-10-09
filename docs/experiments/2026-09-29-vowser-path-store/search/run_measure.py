#!/usr/bin/env python3
"""합성 검색 실험 보정·본측정. 본측정은 부모의 순서 승인 뒤에만 실행."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import signal
import statistics
import time
from pathlib import Path

import numpy as np
import psutil

from shared.data import path_record
from search.build_inputs import ASSETS, checksum, validate as validate_inputs
from search.build_oracle import validate as validate_oracle
from search.search_adapters import MysqlFaissSearch, NeoSearch

HERE = Path(__file__).resolve().parent
RUNS = HERE / "runs"
SCALES = (1000, 10000, 30000)
HINTS = (False, True)
LIMITS = (3, 10)
TRAIN_IDS = tuple(range(200, 250))
TEST_IDS = tuple(range(200))
SEED = 20260929
TOL = 1e-4
GRID = ((5, 32), (10, 64), (20, 128), (40, 256), (80, 512))
REQUEST_TIMEOUT_S = 30


def timeout_handler(_signum, _frame) -> None:
    raise TimeoutError(f"request exceeded {REQUEST_TIMEOUT_S}s")


def bounded_call(adapter, arm: str, vector: np.ndarray, domain: str | None,
                 domain_id: int | None, limit: int, setting: dict) -> dict:
    signal.setitimer(signal.ITIMER_REAL, REQUEST_TIMEOUT_S)
    try:
        return call_arm(adapter, arm, vector, domain, domain_id, limit, setting)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


def reset_after_error(adapter, args) -> tuple[object, float]:
    """시간 초과 뒤 같은 연결에서 늦은 응답을 읽지 않도록 새 연결/인덱스를 준비."""
    started = time.perf_counter_ns()
    adapter.close()
    fresh = NeoSearch() if args.backend == "neo" else MysqlFaissSearch(args.n)
    return fresh, round((time.perf_counter_ns()-started)/1e6, 3)


def load_inputs(distribution: str, n: int):
    validate_inputs()
    validate_oracle()
    queries = np.load(ASSETS / f"queries_{distribution}.npy", mmap_mode="r")
    paths = np.load(ASSETS / f"paths_{distribution}.npy", mmap_mode="r")
    metadata = [json.loads(line) for line in (ASSETS / f"queries_{distribution}.jsonl").read_text(encoding="utf-8").splitlines()]
    oracle = [json.loads(line) for line in (ASSETS / f"oracle_{distribution}_{n}.jsonl").read_text(encoding="utf-8").splitlines()]
    if len(metadata) != 250 or len(oracle) != 250:
        raise AssertionError("query metadata/oracle row count mismatch")
    for qid in range(250):
        if metadata[qid]["query_id"] != qid or oracle[qid]["query_id"] != qid:
            raise AssertionError("query ID order mismatch")
        if metadata[qid]["split"] != ("test" if qid < 200 else "train"):
            raise AssertionError("train/test split mismatch")
    return queries, paths, metadata, oracle


def domain_for(meta: dict, hint: bool) -> str | None:
    return f"d{meta['domain_id']:02d}.example.test" if hint else None


def target_for(oracle: list[dict], qid: int, hint: bool, limit: int) -> list[int]:
    return [int(item["path_id"]) for item in oracle[qid]["hint" if hint else "no_hint"][:limit]]


def recall(found: list[int], target: list[int]) -> float | None:
    return len(set(found).intersection(target)) / len(target) if target else None


def calibration_key(hint: bool, limit: int) -> str:
    return f"{'hint' if hint else 'no_hint'}_top{limit}"


def calibrate(args, queries, metadata, oracle, adapter) -> dict:
    """훈련 질의만 사용. 5개의 고정 후보/efSearch 쌍 중 최초 목표 충족값 선택."""
    settings = {}
    for hint in HINTS:
        for limit in LIMITS:
            key = calibration_key(hint, limit)
            if args.backend == "neo" and hint:
                settings[key] = {"method": "exact_domain_scan", "candidate_k": None,
                                 "ef_search": None, "train_candidate_recall": 1.0,
                                 "train_answerable_queries": sum(bool(target_for(oracle, q, hint, min(limit, 3))) for q in TRAIN_IDS)}
                continue
            trials = []
            for multiplier, ef_search in GRID:
                candidate_k = limit * multiplier
                values = []
                empty_count = 0
                for qid in TRAIN_IDS:
                    target = target_for(oracle, qid, hint, min(limit, 3))
                    if not target:
                        empty_count += 1
                        continue
                    vector = np.asarray(queries[qid], dtype=np.float32)
                    if args.backend == "neo":
                        candidates = adapter.index_candidate_ids(vector, candidate_k)
                    else:
                        candidates = adapter.index_candidate_ids(vector, metadata[qid]["domain_id"] if hint else None, candidate_k, ef_search)
                    values.append(recall(candidates, target))
                trial = {"candidate_k": candidate_k, "ef_search": ef_search if args.backend == "mysql" else None,
                         "train_candidate_recall": statistics.mean(values),
                         "train_answerable_queries": len(values), "train_empty_queries": empty_count}
                trials.append(trial)
            chosen = next((trial for trial in trials if trial["train_candidate_recall"] >= .95),
                          max(trials, key=lambda trial: (trial["train_candidate_recall"], -trial["candidate_k"])))
            settings[key] = {**chosen, "grid_trials": trials, "target_met": chosen["train_candidate_recall"] >= .95}
    return settings


def check_payload(result: dict, vector: np.ndarray, paths: np.ndarray, distribution: str,
                  domain: str | None) -> str | None:
    """계측 종료 후 반환 전체 필드·raw score를 독립 생성 자료와 대조."""
    ids, scores = result["path_ids"], result["raw_scores"]
    body = result["payload"]
    if len(ids) != len(scores) or len(ids) != len(body["matched_paths"]) or len(ids) != body["total_matched"]:
        return "count mismatch"
    for pid, score, returned in zip(ids, scores, body["matched_paths"]):
        source = path_record(pid, distribution)
        exact = float(np.dot(vector, paths[pid]))
        if abs(score - exact) > TOL or score <= .3:
            return f"score mismatch path={pid} delta={score-exact:.8f}"
        if domain is not None and source["domain"] != domain:
            return f"domain mismatch path={pid}"
        expected_steps = [{"order": step["ordinal"], "url": step["url"], "action": step["action"],
                           "selectors": step["selectors"], "description": step["description"],
                           "isInput": step["isInput"], "inputType": None, "inputPlaceholder": None,
                           "shouldWait": step["shouldWait"], "waitMessage": None,
                           "textLabels": step["textLabels"]} for step in source["steps"]]
        expected = {"domain": source["domain"], "taskIntent": source["intent"],
                    "relevance_score": round(score, 3), "weight": 1, "steps": expected_steps}
        if returned != expected:
            return f"full path payload mismatch path={pid}"
    return None


def call_arm(adapter, arm: str, vector: np.ndarray, domain: str | None,
             domain_id: int | None, limit: int, setting: dict) -> dict:
    if arm == "neo_original":
        return adapter.original(vector, limit, domain)
    if arm == "neo_optimized":
        return adapter.optimized(vector, limit, domain, setting["candidate_k"] or limit * 5)
    return adapter.search(vector, limit, domain_id, setting["candidate_k"], setting["ef_search"])


def write_json_exclusive(path: Path, value: dict) -> None:
    with path.open("x", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")


def run_measure(args, queries, paths, metadata, oracle, adapter, calibration: dict):
    arms = ("neo_original", "neo_optimized") if args.backend == "neo" else ("mysql_faiss",)
    header = {"backend": args.backend, "n": args.n, "distribution": args.distribution,
              "seed": SEED, "train_ids": [200, 249], "test_ids": [0, 199],
              "round_index": args.round_index, "rounds_in_file": 1,
              "warmup_per_arm_condition": 200, "request_timeout_seconds": REQUEST_TIMEOUT_S,
              "input_manifest_sha256": checksum(ASSETS / "manifest.json"),
              "oracle_manifest_sha256": checksum(ASSETS / "oracle_manifest.json"),
              "calibration_sha256": checksum(args.calibration),
              "faiss_index_build_ms": getattr(adapter, "index_build_ms", None),
              "rss_after_index_bytes": psutil.Process().memory_info().rss}
    output = RUNS / f"{args.label}.jsonl"
    if output.exists():
        raise RuntimeError(f"measurement output already exists: {output}")
    with output.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps({"kind": "header", **header}, sort_keys=True) + "\n")
        for hint in HINTS:
            for limit in LIMITS:
                key = calibration_key(hint, limit)
                setting = calibration["settings"][key]
                # 모든 군에서 동일한 train50을 4회 반복. Neo 두 군은 q별 AB/BA 순서를 바꾼다.
                rng = random.Random(SEED + args.n + int(hint) * 100 + limit + args.round_index * 10000)
                warmups = []
                for repeat in range(4):
                    qids = list(TRAIN_IDS)
                    rng.shuffle(qids)
                    for qid in qids:
                        order = list(arms)
                        rng.shuffle(order)
                        for arm in order:
                            vector = np.asarray(queries[qid], dtype=np.float32)
                            domain = domain_for(metadata[qid], hint)
                            started = time.perf_counter_ns()
                            try:
                                result = bounded_call(adapter, arm, vector, domain,
                                                      metadata[qid]["domain_id"] if hint else None, limit, setting)
                                warmups.append({"arm": arm, "elapsed_ms": result["elapsed_ms"], "ok": True})
                            except Exception as error:
                                failed = {"arm": arm, "elapsed_ms": round((time.perf_counter_ns()-started)/1e6, 3),
                                          "ok": False, "error_type": type(error).__name__, "error": str(error)[:500]}
                                adapter, failed["connection_reset_ms"] = reset_after_error(adapter, args)
                                warmups.append(failed)
                stream.write(json.dumps({"kind": "warmup", "condition": key, "count": len(warmups),
                                         "records": warmups}, sort_keys=True) + "\n")
                stream.flush()
                for round_id in (args.round_index,):
                    qids = list(TEST_IDS)
                    rng.shuffle(qids)
                    for sequence, qid in enumerate(qids):
                        order = list(arms)
                        rng.shuffle(order)
                        for arm in order:
                            vector = np.asarray(queries[qid], dtype=np.float32)
                            domain = domain_for(metadata[qid], hint)
                            target = target_for(oracle, qid, hint, limit)
                            record = {"kind": "sample", "arm": arm, "condition": key, "query_id": qid,
                                      "round": round_id, "sequence": sequence, "hint": hint, "limit": limit,
                                      "target_ids": target, "answerable": bool(target),
                                      "ood": bool(metadata[qid]["ood"])}
                            started = time.perf_counter_ns()
                            try:
                                result = bounded_call(adapter, arm, vector, domain,
                                                      metadata[qid]["domain_id"] if hint else None, limit, setting)
                                record["harness_wall_ms"] = round((time.perf_counter_ns()-started)/1e6, 3)
                                invalid = check_payload(result, vector, paths, args.distribution, domain)
                                payload_bytes = json.dumps(result["payload"], ensure_ascii=False,
                                                           separators=(",", ":")).encode("utf-8")
                                record.update({"ok": invalid is None, "validation_error": invalid,
                                               "elapsed_ms": result["elapsed_ms"], "phases_ms": result["phases_ms"],
                                               "db_roundtrips": result["db_roundtrips"],
                                               "db_return_estimated_bytes": result["db_return_estimated_bytes"],
                                               "json_bytes": result["json_bytes"],
                                               "payload_sha256": hashlib.sha256(payload_bytes).hexdigest(),
                                               "path_ids": result["path_ids"], "raw_scores": result["raw_scores"],
                                               "candidate_count": result["candidate_count"],
                                               "candidate_recall_post_query": recall(result["candidate_ids"], target) if "candidate_ids" in result else None,
                                               "effective_recall": recall(result["path_ids"], target),
                                               "exact_order": result["path_ids"] == target,
                                               "empty_correct": not result["path_ids"] if not target else None})
                            except Exception as error:
                                record.update({"ok": False, "elapsed_ms": round((time.perf_counter_ns()-started)/1e6, 3),
                                               "error_type": type(error).__name__, "error": str(error)[:500]})
                                adapter, record["connection_reset_ms"] = reset_after_error(adapter, args)
                            record["rss_bytes"] = psutil.Process().memory_info().rss
                            stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
                    stream.flush()
                # 해당 조건의 본측정 후 raw ANN 후보를 검사. 첫 라운드에만 실행, 튜닝 없음.
                for arm in arms if args.round_index == 0 else ():
                    probe = []
                    for qid in TEST_IDS:
                        target = target_for(oracle, qid, hint, min(limit, 3))
                        if not target:
                            continue
                        vector = np.asarray(queries[qid], dtype=np.float32)
                        if arm == "neo_optimized" and hint:
                            found = target  # 도메인 관계 exact scan; ANN 지표와 구분
                        elif args.backend == "neo":
                            count = limit * 5 if arm == "neo_original" else setting["candidate_k"]
                            found = adapter.index_candidate_ids(vector, count)
                        else:
                            found = adapter.index_candidate_ids(vector, metadata[qid]["domain_id"] if hint else None,
                                                                setting["candidate_k"], setting["ef_search"])
                        probe.append({"query_id": qid, "recall_at3": recall(found, target)})
                    stream.write(json.dumps({"kind": "quality_probe", "condition": key, "arm": arm,
                                             "method": "exact_domain_scan" if arm == "neo_optimized" and hint else "ann_candidate",
                                             "answerable_count": len(probe),
                                             "mean_candidate_recall_at3": statistics.mean(row["recall_at3"] for row in probe),
                                             "records": probe}, sort_keys=True) + "\n")
                    stream.flush()
    print(json.dumps({"status": "complete", "output": str(output), "sha256": checksum(output)}, sort_keys=True))
    return adapter


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("calibrate", "measure"))
    parser.add_argument("--backend", choices=("neo", "mysql"), required=True)
    parser.add_argument("--n", type=int, choices=SCALES, required=True)
    parser.add_argument("--distribution", choices=("uniform", "skew"), required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--calibration", type=Path)
    parser.add_argument("--round-index", type=int, choices=(0, 1, 2))
    args = parser.parse_args()
    RUNS.mkdir(exist_ok=True)
    queries, paths, metadata, oracle = load_inputs(args.distribution, args.n)
    adapter = NeoSearch() if args.backend == "neo" else MysqlFaissSearch(args.n)
    try:
        if args.stage == "calibrate":
            output = RUNS / f"{args.label}.calibration.json"
            settings = calibrate(args, queries, metadata, oracle, adapter)
            record = {"backend": args.backend, "n": args.n, "distribution": args.distribution,
                      "grid": GRID, "train_ids": [200, 249], "settings": settings,
                      "rss_after_index_bytes": psutil.Process().memory_info().rss,
                      "faiss_index_build_ms": getattr(adapter, "index_build_ms", None),
                      "input_manifest_sha256": checksum(ASSETS / "manifest.json"),
                      "oracle_manifest_sha256": checksum(ASSETS / "oracle_manifest.json")}
            write_json_exclusive(output, record)
            print(json.dumps({"status": "calibrated", "output": str(output), "sha256": checksum(output),
                              "settings": settings}, sort_keys=True))
        else:
            if args.calibration is None:
                parser.error("measure requires --calibration")
            if args.round_index is None:
                parser.error("measure requires --round-index")
            calibration = json.loads(args.calibration.read_text(encoding="utf-8"))
            if (calibration["backend"], calibration["n"], calibration["distribution"]) != (args.backend, args.n, args.distribution):
                raise RuntimeError("calibration condition mismatch")
            signal.signal(signal.SIGALRM, timeout_handler)
            adapter = run_measure(args, queries, paths, metadata, oracle, adapter, calibration)
    finally:
        adapter.close()


if __name__ == "__main__":
    main()
