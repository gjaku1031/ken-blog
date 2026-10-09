#!/usr/bin/env python3
"""비밀 환경변수를 배제한 이미지·컨테이너 자원 계약 기록."""

import json
import platform
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def output(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout.strip()


def inspect(kind, name):
    return json.loads(output("docker", kind, "inspect", name))[0]


record = {
    "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "host": platform.platform(),
    "architecture": platform.machine(),
    "docker_server": output("docker", "version", "--format", "{{.Server.Version}}"),
    "image": {},
    "containers": {},
    "worker_pip_freeze": output("bash", str(HERE / "run-client.sh"), "python", "-m", "pip", "freeze"),
}
for name in ("mysql:8.4.11", "neo4j:5.26.19-community", "vowser-eval-v2-client:py312"):
    image = inspect("image", name)
    record["image"][name] = {"id": image["Id"], "repo_digests": image["RepoDigests"]}
for name in ("vowser-eval-v2-mysql", "vowser-eval-v2-neo4j"):
    item = inspect("container", name)
    host = item["HostConfig"]
    record["containers"][name] = {
        "image_id": item["Image"],
        "running": item["State"]["Running"],
        "nano_cpus": host["NanoCpus"],
        "memory_bytes": host["Memory"],
        "memory_swap_bytes": host["MemorySwap"],
        "port_bindings": host["PortBindings"],
        "labels": item["Config"]["Labels"],
    }
(HERE / "environment.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
print("shared/environment.json written without container Env")
