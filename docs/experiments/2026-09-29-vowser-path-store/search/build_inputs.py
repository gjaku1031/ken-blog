#!/usr/bin/env python3
"""실험 1의 합성 1536차원 경로·독립 질의 벡터를 생성한다."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
sys.path.insert(0, str(HERE.parent))
from shared import data as shared_data
DIM = 1536
MAX_PATHS = 30_000
SEED = 20260929
DISTRIBUTIONS = ("uniform", "skew")


def unit(a: np.ndarray) -> np.ndarray:
    a = np.asarray(a, dtype=np.float32)
    return a / np.linalg.norm(a, axis=-1, keepdims=True).astype(np.float32)


def domain_ids(path_ids: np.ndarray, distribution: str) -> np.ndarray:
    group = path_ids // 3
    if distribution == "uniform":
        return group % 30
    if distribution == "skew":
        return np.where(group % 2 == 0, 0, 1 + (group // 2) % 29)
    raise ValueError(distribution)


def intent_ids(path_ids: np.ndarray) -> np.ndarray:
    return (path_ids // 3) % 96


def checksum(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def make() -> None:
    if ASSETS.exists() and any(ASSETS.iterdir()):
        raise RuntimeError("assets already exist; preserve frozen data and use a new experiment version")
    ASSETS.mkdir(parents=True, exist_ok=True)
    for distribution in DISTRIBUTIONS:
        expected = domain_ids(np.arange(MAX_PATHS), distribution)
        actual = np.fromiter((shared_data.domain_id(i, distribution) for i in range(MAX_PATHS)), dtype=np.int32)
        if not np.array_equal(expected, actual):
            raise RuntimeError(f"shared domain contract mismatch: {distribution}")
    if not np.array_equal(intent_ids(np.arange(MAX_PATHS)), np.fromiter((shared_data.intent_id(i) for i in range(MAX_PATHS)), dtype=np.int32)):
        raise RuntimeError("shared intent contract mismatch")
    rng_proto = np.random.default_rng(SEED)
    parents = unit(rng_proto.standard_normal((48, DIM), dtype=np.float32))
    offsets = unit(rng_proto.standard_normal((96, DIM), dtype=np.float32))
    intents = unit(0.85 * parents[np.arange(96) // 2] + 0.15 * offsets)
    domains = unit(rng_proto.standard_normal((30, DIM), dtype=np.float32))

    for distribution in DISTRIBUTIONS:
        target = ASSETS / f"paths_{distribution}.npy"
        matrix = np.lib.format.open_memmap(target, mode="w+", dtype=np.float32, shape=(MAX_PATHS, DIM))
        rng_paths = np.random.default_rng(SEED + (100 if distribution == "uniform" else 200))
        for start in range(0, MAX_PATHS, 256):
            end = min(start + 256, MAX_PATHS)
            ids = np.arange(start, end, dtype=np.int32)
            noise = unit(rng_paths.standard_normal((end - start, DIM), dtype=np.float32))
            matrix[start:end] = unit(0.75 * intents[intent_ids(ids)] + 0.12 * domains[domain_ids(ids, distribution)] + 0.55 * noise)
        matrix.flush()
        del matrix
        meta = []
        query_matrix = np.lib.format.open_memmap(ASSETS / f"queries_{distribution}.npy", mode="w+", dtype=np.float32, shape=(250, DIM))
        rng_query = np.random.default_rng(SEED + (300 if distribution == "uniform" else 400))
        for qid in range(250):
            split = "test" if qid < 200 else "train"
            local_index = qid if split == "test" else qid - 200
            ood = local_index < (10 if split == "test" else 2)
            # 첫 1k에 반드시 존재하는 group에서 (intent,domain)을 함께 골라
            # 분포와 무관하게 대부분의 힌트 질의에 eligible 정답이 있게 한다.
            anchor_group = (qid * 37 + 53) % 333
            intent = anchor_group % 96
            domain = int(domain_ids(np.asarray([anchor_group * 3]), distribution)[0])
            noise = unit(rng_query.standard_normal(DIM, dtype=np.float32))
            vector = noise if ood else unit(0.75 * intents[intent] + 0.12 * domains[domain] + 0.55 * noise)
            query_matrix[qid] = vector
            meta.append({"query_id": qid, "split": split, "intent_id": intent, "domain_id": domain, "anchor_group": anchor_group, "ood": ood})
        query_matrix.flush()
        del query_matrix
        (ASSETS / f"queries_{distribution}.jsonl").write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in meta), encoding="utf-8")
    filenames = [f"paths_{d}.npy" for d in DISTRIBUTIONS]
    filenames += [f"queries_{d}.npy" for d in DISTRIBUTIONS]
    filenames += [f"queries_{d}.jsonl" for d in DISTRIBUTIONS]
    manifest = {
        "seed": SEED, "dim": DIM, "path_count_max": MAX_PATHS,
        "depth_counts_by_prefix": {str(n): {str(depth): int(np.count_nonzero((np.arange(n) % 3) == i)) for i, depth in enumerate((5, 10, 20))} for n in (1000, 10000, 30000)},
        "domain_distribution": {distribution: {str(d): int(np.count_nonzero(domain_ids(np.arange(MAX_PATHS), distribution) == d)) for d in range(30)} for distribution in DISTRIBUTIONS},
        "files_sha256": {name: checksum(ASSETS / name) for name in filenames},
        "generator_sha256": checksum(Path(__file__)),
        "shared_data_sha256": checksum(Path(shared_data.__file__)),
        "vector_method": "normalized(0.75*intent_prototype + 0.12*domain_prototype + 0.55*independent_unit_noise); query and path RNG streams disjoint; OOD uses independent unit noise",
    }
    (ASSETS / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def validate() -> None:
    manifest = json.loads((ASSETS / "manifest.json").read_text(encoding="utf-8"))
    for name, expected in manifest["files_sha256"].items():
        if checksum(ASSETS / name) != expected:
            raise RuntimeError(f"SHA-256 mismatch: {name}")
    if checksum(Path(__file__)) != manifest["generator_sha256"]:
        raise RuntimeError("generator changed since freeze")
    if checksum(Path(shared_data.__file__)) != manifest["shared_data_sha256"]:
        raise RuntimeError("shared generator changed since freeze")
    for distribution in DISTRIBUTIONS:
        matrix = np.load(ASSETS / f"paths_{distribution}.npy", mmap_mode="r")
        if matrix.shape != (MAX_PATHS, DIM):
            raise RuntimeError(f"path shape mismatch: {distribution}")
        queries = np.load(ASSETS / f"queries_{distribution}.npy", mmap_mode="r")
        if queries.shape != (250, DIM):
            raise RuntimeError(f"query shape mismatch: {distribution}")
    print(json.dumps({"status": "valid", "paths": MAX_PATHS, "queries": 250, "sha256": manifest["files_sha256"]}, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("make", "validate"))
    args = parser.parse_args()
    make() if args.phase == "make" else validate()
