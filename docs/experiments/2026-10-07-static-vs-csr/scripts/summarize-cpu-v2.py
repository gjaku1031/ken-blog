#!/usr/bin/env python3
import csv
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)

def stats(values):
    values = sorted(values)
    if not values:
        return {"n": 0, "average": None, "maximum": None, "p95": None}
    return {"n": len(values), "average": sum(values) / len(values), "maximum": values[-1], "p95": values[max(0, math.ceil(.95 * len(values)) - 1)]}

with Path("results-v2/docker-stats-1s.csv").open(encoding="utf-8", newline="") as stream:
    samples = list(csv.DictReader(stream))
for row in samples:
    row["time"] = parse_time(row["utc"])
    row["cpu"] = float(row["cpu_percent"]) if row["cpu_percent"] else None

runs = [json.loads(line) for line in Path("results-v2/load-replay-results.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
with Path("results-v2/load-cpu-summary.csv").open("w", encoding="utf-8", newline="") as stream:
    writer = csv.DictWriter(stream, fieldnames=["implementation", "window_start_utc", "window_end_utc", "sample_count", "average_cpu_percent", "maximum_cpu_percent", "p95_cpu_percent"])
    writer.writeheader()
    for run in runs:
        start, end = parse_time(run["first_reader_utc"]), parse_time(run["finished_utc"])
        name = "kenblog-v2-api-csr" if run["implementation"] == "csr" else "kenblog-v2-api-hybrid"
        values = [x["cpu"] for x in samples if x["container"] == name and start <= x["time"] <= end and x["cpu"] is not None]
        result = stats(values)
        writer.writerow({"implementation": run["implementation"], "window_start_utc": start.isoformat(), "window_end_utc": end.isoformat(),
            "sample_count": result["n"], "average_cpu_percent": result["average"], "maximum_cpu_percent": result["maximum"], "p95_cpu_percent": result["p95"]})

matrix = [json.loads(line) for line in Path("results-v2/perf-runs.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
measurement_start = min(parse_time(x["utc_started"]) for x in matrix)
baseline_start = measurement_start - timedelta(seconds=30)
with Path("results-v2/api-cpu-baseline.csv").open("w", encoding="utf-8", newline="") as stream:
    writer = csv.DictWriter(stream, fieldnames=["container", "window_start_utc", "window_end_utc", "sample_count", "average_cpu_percent", "maximum_cpu_percent", "p95_cpu_percent"])
    writer.writeheader()
    for name in ("kenblog-v2-api-csr", "kenblog-v2-api-hybrid"):
        values = [x["cpu"] for x in samples if x["container"] == name and baseline_start <= x["time"] < measurement_start and x["cpu"] is not None]
        result = stats(values)
        writer.writerow({"container": name, "window_start_utc": baseline_start.isoformat(), "window_end_utc": measurement_start.isoformat(),
            "sample_count": result["n"], "average_cpu_percent": result["average"], "maximum_cpu_percent": result["maximum"], "p95_cpu_percent": result["p95"]})
print("wrote results-v2/load-cpu-summary.csv and results-v2/api-cpu-baseline.csv")
