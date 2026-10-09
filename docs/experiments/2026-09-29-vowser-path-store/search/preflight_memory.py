#!/usr/bin/env python3
"""본측정 전 MySQL BLOB→FAISS 전역/도메인 인덱스 1 GiB peak 확인."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import resource
import time

import psutil

from search.search_adapters import MysqlFaissSearch

HERE = Path(__file__).resolve().parent


def cgroup_value(name: str) -> int | None:
    path = Path("/sys/fs/cgroup") / name
    if not path.exists():
        return None
    value = path.read_text().strip()
    return None if value == "max" else int(value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, required=True)
    parser.add_argument("--distribution", choices=("uniform", "skew"), required=True)
    parser.add_argument("--label", required=True)
    args = parser.parse_args()
    target = HERE / "loads" / f"{args.label}.memory_preflight.json"
    if target.exists():
        raise RuntimeError("preflight record exists")
    process = psutil.Process()
    started = time.perf_counter()
    before = process.memory_info().rss
    adapter = MysqlFaissSearch(args.n)
    try:
        result = {"n": args.n, "distribution": args.distribution,
                  "rss_before_bytes": before, "rss_after_index_bytes": process.memory_info().rss,
                  "process_peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
                  "cgroup_memory_current_bytes": cgroup_value("memory.current"),
                  "cgroup_memory_peak_bytes": cgroup_value("memory.peak"),
                  "cgroup_memory_limit_bytes": cgroup_value("memory.max"),
                  "global_index_vectors": adapter.index.ntotal,
                  "domain_index_vectors": sum(index.ntotal for index in adapter.domain_indexes.values()),
                  "index_build_ms": adapter.index_build_ms,
                  "wall_seconds": round(time.perf_counter()-started, 3)}
    finally:
        adapter.close()
    if result["global_index_vectors"] != args.n or result["domain_index_vectors"] != args.n:
        raise AssertionError("FAISS index count mismatch")
    target.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
