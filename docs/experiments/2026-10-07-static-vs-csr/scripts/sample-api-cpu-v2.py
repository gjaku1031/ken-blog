#!/usr/bin/env python3
import csv
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

output = Path("results-v2/docker-stats-1s.csv")
output.parent.mkdir(parents=True, exist_ok=True)
containers = ["kenblog-v2-api-csr", "kenblog-v2-api-hybrid"]
paths = {}
for name in containers:
    pid = subprocess.check_output(["docker", "inspect", "--format", "{{.State.Pid}}", name], text=True).strip()
    entries = Path(f"/proc/{pid}/cgroup").read_text().splitlines()
    unified = next(row.split("::", 1)[1] for row in entries if "::" in row)
    paths[name] = Path("/sys/fs/cgroup") / unified.lstrip("/")
previous = {}
with output.open("w", newline="", encoding="utf-8") as stream:
    writer = csv.writer(stream)
    writer.writerow(["utc", "container", "cpu_percent", "usage_delta_usec", "interval_ms", "memory_current_bytes"])
    stream.flush()
    while True:
        started = time.monotonic()
        stamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        for name, root in paths.items():
            usage = next(int(line.split()[1]) for line in (root / "cpu.stat").read_text().splitlines() if line.startswith("usage_usec "))
            memory = int((root / "memory.current").read_text().strip())
            sampled = time.monotonic()
            prior = previous.get(name)
            if prior:
                delta = max(0, usage - prior[0])
                interval = (sampled - prior[1]) * 1000
                cpu_pct = delta / max(1, interval * 1000) * 100
            else:
                delta, interval, cpu_pct = "", "", ""
            writer.writerow([stamp, name, cpu_pct, delta, interval, memory])
            previous[name] = (usage, sampled)
        stream.flush()
        remaining = 1.0 - (time.monotonic() - started)
        if remaining > 0:
            time.sleep(remaining)
