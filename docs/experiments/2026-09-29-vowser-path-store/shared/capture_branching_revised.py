#!/usr/bin/env python3
"""원본 shared 환경 파일을 수정하지 않고 보정 분기 실험 환경을 기록."""

import hashlib
import json
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = HERE / "environment-branching-revised.json"
PRESERVED = ("environment.json", "environment-before-branching.json", "environment-branching.json")


def output(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout.strip()


def inspect(kind, name):
    return json.loads(output("docker", kind, "inspect", name))[0]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    if TARGET.exists():
        raise FileExistsError(TARGET)
    record = {
        "utc": datetime.now(timezone.utc).isoformat(),
        "host": platform.platform(),
        "architecture": platform.machine(),
        "docker_server": output("docker", "version", "--format", "{{.Server.Version}}"),
        "image": {},
        "containers": {},
        "worker_pip_freeze": output("bash", str(HERE / "run-client.sh"), "python", "-m", "pip", "freeze"),
        "preserved_environment_sha256": {name: sha256(HERE / name) for name in PRESERVED},
        "recreation_helper_sha256": sha256(HERE / "recreate_branching_revised.sh"),
    }
    for name in ("mysql:8.4.11", "neo4j:5.26.19-community", "vowser-eval-v2-client:py312"):
        image = inspect("image", name)
        record["image"][name] = {"id": image["Id"], "repo_digests": image["RepoDigests"]}
    for name in ("vowser-eval-v2-mysql", "vowser-eval-v2-neo4j"):
        item = inspect("container", name)
        host = item["HostConfig"]
        if item["State"]["Running"]:
            raise AssertionError(f"Dedicated DB must be stopped at snapshot: {name}")
        record["containers"][name] = {
            "image_id": item["Image"],
            "running": item["State"]["Running"],
            "nano_cpus": host["NanoCpus"],
            "memory_bytes": host["Memory"],
            "memory_swap_bytes": host["MemorySwap"],
            "port_bindings": host["PortBindings"],
            "labels": item["Config"]["Labels"],
        }
    with TARGET.open("x", encoding="utf-8") as stream:
        json.dump(record, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print("shared/environment-branching-revised.json written without container Env")


if __name__ == "__main__":
    main()
