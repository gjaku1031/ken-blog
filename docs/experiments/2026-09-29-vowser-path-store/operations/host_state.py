#!/usr/bin/env python3
"""각 측정 블록 전후 호스트·전용 DB 자원 스냅숏."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

NAMES = {"mysql": "vowser-eval-v2-mysql", "neo4j": "vowser-eval-v2-neo4j"}


def command(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=15, check=False)
    return {"exit_code": result.returncode, "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip()[:500]}


def snapshot(backend):
    name = NAMES[backend]
    meminfo = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        meminfo[key] = int(value.strip().split()[0]) * 1024
    stats = command("docker", "stats", "--no-stream", "--format", "{{json .}}")
    containers = []
    if stats["exit_code"] == 0:
        for line in stats["stdout"].splitlines():
            try:
                item = json.loads(line)
                containers.append({key: item.get(key) for key in ("Name", "CPUPerc", "MemUsage")})
            except json.JSONDecodeError:
                continue
    db_path = "/var/lib/mysql/vowser_eval_v2" if backend == "mysql" else "/data/databases/neo4j"
    return {
        "time_utc": datetime.now(timezone.utc).isoformat(),
        "backend": backend,
        "host_load_1_5_15": os.getloadavg(),
        "host_memory_available_bytes": meminfo["MemAvailable"],
        "host_memory_used_bytes": meminfo["MemTotal"] - meminfo["MemAvailable"],
        "running_container_stats": containers,
        "db_cpu_stat": command("docker", "exec", name, "cat", "/sys/fs/cgroup/cpu.stat"),
        "db_memory_current": command("docker", "exec", name, "cat", "/sys/fs/cgroup/memory.current"),
        "db_memory_peak": command("docker", "exec", name, "cat", "/sys/fs/cgroup/memory.peak"),
        "db_store_du_bytes": command("docker", "exec", name, "du", "-sb", db_path),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=NAMES, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(exist_ok=True)
    args.output.write_text(json.dumps(snapshot(args.backend), ensure_ascii=False, indent=2) + "\n")
