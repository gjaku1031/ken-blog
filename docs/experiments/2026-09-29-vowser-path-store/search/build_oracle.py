#!/usr/bin/env python3
"""도메인 선필터와 raw cosine>0.3을 적용한 exact 정답표 생성."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
import numpy as np

from build_inputs import ASSETS, DISTRIBUTIONS, checksum, domain_ids, validate as validate_inputs

SCALES = (1_000, 10_000, 30_000)
CUTOFF = 0.3


def top_ten(scores: np.ndarray) -> list[dict]:
    ids = np.flatnonzero(scores > CUTOFF)
    if ids.size == 0:
        return []
    order = np.lexsort((ids, -scores[ids]))[:10]
    return [{"path_id": int(i), "cosine": round(float(scores[i]), 7)} for i in ids[order]]


def make() -> None:
    validate_inputs()
    file_hashes = {}
    counts = {}
    for distribution in DISTRIBUTIONS:
        matrix = np.load(ASSETS / f"paths_{distribution}.npy", mmap_mode="r")
        queries = np.load(ASSETS / f"queries_{distribution}.npy", mmap_mode="r")
        metadata = [json.loads(line) for line in (ASSETS / f"queries_{distribution}.jsonl").read_text(encoding="utf-8").splitlines()]
        for n in SCALES:
            domains = domain_ids(np.arange(n, dtype=np.int32), distribution)
            path = ASSETS / f"oracle_{distribution}_{n}.jsonl"
            none_count = {"no_hint": 0, "hint": 0}
            with path.open("w", encoding="utf-8") as output:
                for item in metadata:
                    qid = item["query_id"]
                    # 같은 float32 원본으로 모든 비교군의 raw cosine 정답을 계산.
                    scores = np.asarray(matrix[:n] @ queries[qid], dtype=np.float32)
                    no_hint = top_ten(scores)
                    hint_scores = scores.copy()
                    hint_scores[domains != item["domain_id"]] = -np.inf
                    hint = top_ten(hint_scores)
                    if not no_hint:
                        none_count["no_hint"] += 1
                    if not hint:
                        none_count["hint"] += 1
                    output.write(json.dumps({"query_id": qid, "split": item["split"], "domain_id": item["domain_id"], "ood": item["ood"], "no_hint": no_hint, "hint": hint}, sort_keys=True) + "\n")
            file_hashes[path.name] = checksum(path)
            counts[f"{distribution}_{n}"] = none_count
    manifest = {
        "method": "numpy float32 matrix dot; domain prefilter; raw cosine > 0.3; descending score, ascending path_id tie-break",
        "cutoff": CUTOFF, "scales": SCALES, "query_count": len(metadata), "no_match_counts": counts,
        "files_sha256": file_hashes,
        "generator_sha256": checksum(Path(__file__)),
        "inputs_manifest_sha256": checksum(ASSETS / "manifest.json"),
    }
    (ASSETS / "oracle_manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def validate() -> None:
    validate_inputs()
    manifest = json.loads((ASSETS / "oracle_manifest.json").read_text(encoding="utf-8"))
    if checksum(Path(__file__)) != manifest["generator_sha256"]:
        raise RuntimeError("oracle generator changed")
    if checksum(ASSETS / "manifest.json") != manifest["inputs_manifest_sha256"]:
        raise RuntimeError("input manifest changed")
    for name, expected in manifest["files_sha256"].items():
        if checksum(ASSETS / name) != expected:
            raise RuntimeError(f"oracle hash mismatch: {name}")
    print(json.dumps({"status": "valid", "oracle_files": len(manifest["files_sha256"]), "none_counts": manifest["no_match_counts"]}, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("make", "validate"))
    args = parser.parse_args()
    make() if args.phase == "make" else validate()
