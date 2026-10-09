"""부모의 명시적 DB lease 후에만 실행하는 사후 단일군 호스트 runner."""

from __future__ import annotations

import argparse
import csv
import json
import os
import signal
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from branching.model import CELLS, STRESS_CELLS, cell_id
from branching.orchestrate import command_log
from manifest import HERE, ROOT, MANIFEST, sha256, verify
from completion import completed_groups

OUT = HERE / "results"
CONTROL = ROOT / "shared" / "db-control.sh"
CLIENT = ROOT / "shared" / "run-client.sh"
CLIENT_NAME = "vowser-eval-v2-br3diag"
MYSQL_NAME = "vowser-eval-v2-mysql"
NEO_NAME = "vowser-eval-v2-neo4j"
LIMIT_SECONDS = 3600


class InterruptedRun(Exception):
    pass


class TimeLimitExceeded(Exception):
    pass


def interrupted(signum, _frame):
    raise InterruptedRun(f"received signal {signum}")


def time_limit(_signum, _frame):
    raise TimeLimitExceeded("diagnostic group wall clock reached 3600 s")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def original_complete() -> None:
    if completed_groups() != verify()["original_completion"]:
        raise RuntimeError("original 20-cell completion evidence changed after diagnostic freeze")


def inspect(name: str) -> dict:
    return json.loads(subprocess.check_output(["docker", "inspect", name], text=True))[0]


def resource_contract() -> dict:
    record = verify()["resource_contract"]
    mysql = inspect(MYSQL_NAME)
    if mysql["HostConfig"]["NanoCpus"] != record["db_nano_cpus"]:
        raise AssertionError("MySQL CPU contract changed")
    if mysql["HostConfig"]["Memory"] != record["db_memory_bytes"]:
        raise AssertionError("MySQL memory contract changed")
    if not (ROOT / "shared" / "environment.json").exists():
        raise AssertionError("shared environment metadata missing")
    shared_path = ROOT / "shared" / "environment.json"
    medium_path = ROOT / "operations" / "results" / "storage-medium.json"
    return {"mysql_container_id": mysql["Id"],
            "mysql_image": mysql["Image"],
            "mysql_nano_cpus": mysql["HostConfig"]["NanoCpus"],
            "mysql_memory_bytes": mysql["HostConfig"]["Memory"],
            "worker_limit_from_frozen_shared_run_client": {
                "nano_cpus": record["worker_nano_cpus"],
                "memory_bytes": record["worker_memory_bytes"]},
            "shared_environment_current_sha256": sha256(shared_path),
            "shared_environment_current": json.loads(shared_path.read_text(encoding="utf-8")),
            "storage_medium_evidence_sha256": sha256(medium_path),
            "storage_medium_evidence_path": str(medium_path.relative_to(ROOT))}


def control(action: str, engine: str, log: Path) -> None:
    command_log(["bash", str(CONTROL), action, engine], log, timeout=100)


def client(command: str, args: list[str], log: Path, *, check: bool = True,
           timeout: float | None = None) -> int:
    env = dict(os.environ, EVAL_CLIENT_NAME="br3diag")
    return command_log(["bash", str(CLIENT), "python", "branching-diagnostic/worker.py",
                        command, *args], log, check=check, timeout=timeout, env=env)


def stop_own_client(log: Path) -> None:
    present = subprocess.run(["docker", "container", "inspect", CLIENT_NAME],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             check=False).returncode == 0
    if present:
        command_log(["docker", "rm", "-f", CLIENT_NAME], log, timeout=30)


def activate(log: Path) -> None:
    control("stop", "neo4j", log)
    control("start", "mysql", log)
    control("ready", "mysql", log)
    deadline = time.monotonic() + 90
    while True:
        try:
            ready = client("health", [], log, check=False, timeout=15) == 0
        except subprocess.TimeoutExpired:
            ready = False
        if ready:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError("authenticated MySQL health not ready within 90 s")
        time.sleep(2)
    if not inspect(MYSQL_NAME)["State"]["Running"] or inspect(NEO_NAME)["State"]["Running"]:
        raise AssertionError("one active DB contract violated")


def cell_parts(item: tuple, stress: bool) -> tuple[str, list[str]]:
    if stress:
        total, depth, share, cap = item
        cell = cell_id(total, share, cap, depth)
        args = ["--total", str(total), "--share", str(share), "--cap", str(cap),
                "--depth", str(depth)]
    else:
        total, share, cap = item
        cell = cell_id(total, share, cap)
        args = ["--total", str(total), "--share", str(share), "--cap", str(cap)]
    return cell, args


def combine(cell: str) -> dict:
    folder = OUT / cell
    target = folder / "raw.csv"
    counts = {"warmup": 0, "measure": 0}
    failures = {"warmup": 0, "measure": 0}
    with target.open("x", newline="", encoding="utf-8") as output:
        writer = None
        for round_number in (0, 1, 2):
            with (folder / f"raw-r{round_number}.csv").open(newline="", encoding="utf-8") as file:
                reader = csv.DictReader(file)
                if writer is None:
                    writer = csv.DictWriter(output, fieldnames=reader.fieldnames)
                    writer.writeheader()
                elif reader.fieldnames != writer.fieldnames:
                    raise AssertionError("raw field list changed between rounds")
                for row in reader:
                    if row["mode"] != "mysql_member_ordered" or int(row["round"]) != round_number:
                        raise AssertionError("raw row mode/round mismatch")
                    phase = row["phase"]
                    if phase not in counts:
                        raise AssertionError("unexpected phase")
                    counts[phase] += 1
                    failures[phase] += row["correct"] != "True"
                    writer.writerow(row)
    complete = counts == {"warmup": 600, "measure": 600}
    summary = {"cell": cell, "mode": "mysql_member_ordered", "counts": counts,
               "failures": failures, "complete": complete, "combined_utc": utc_now(),
               "raw_sha256": sha256(target)}
    write_json(folder / "summary.json", summary)
    if not complete:
        raise AssertionError("cell raw incomplete; preserve original attempts")
    return summary


def run(group: str) -> None:
    original_complete()
    manifest = verify()
    OUT.mkdir(parents=True, exist_ok=True)
    status_path = OUT / f"{group}-status.json"
    if status_path.exists():
        raise FileExistsError("diagnostic group already attempted; preserve prior result")
    if group == "main" and (OUT / "stress-status.json").exists():
        raise RuntimeError("run main before stress")
    if group == "stress":
        main = json.loads((OUT / "main-status.json").read_text(encoding="utf-8"))
        if main["state"] not in ("complete", "time_limit_incomplete"):
            raise RuntimeError("main diagnostic not closed cleanly; no selective stress rerun")
    cells = STRESS_CELLS if group == "stress" else CELLS
    environment = resource_contract()
    write_json(OUT / f"{group}-environment.json", environment)
    status = {"group": group, "state": "running", "started_utc": utc_now(),
              "limit_seconds": LIMIT_SECONDS, "manifest_sha256": sha256(MANIFEST),
              "original_arm": "untouched", "posthoc_arm": "mysql_member_ordered",
              "expected_cells": [cell_parts(item, group == "stress")[0] for item in cells],
              "completed_cells": [], "expected_warmup": len(cells) * 600,
              "expected_measured": len(cells) * 600}
    if manifest["cell_names"][:len(CELLS)] != [cell_parts(item, False)[0] for item in CELLS]:
        raise AssertionError("main cell order changed")
    write_json(status_path, status)
    start = time.monotonic()
    deadline = start + LIMIT_SECONDS
    global_log = OUT / f"host-{group}.log"
    try:
        signal.setitimer(signal.ITIMER_REAL, LIMIT_SECONDS)
        for item in cells:
            if time.monotonic() >= deadline:
                status["state"] = "time_limit_incomplete"
                break
            cell, args = cell_parts(item, group == "stress")
            status["active_cell"] = cell
            write_json(status_path, status)
            folder = OUT / cell
            folder.mkdir(parents=True, exist_ok=True)
            log = folder / "host.log"
            activate(log)
            if time.monotonic() >= deadline:
                status["state"] = "time_limit_incomplete"
                status["partial_cell"] = cell
                break
            client("prepare", args, log, timeout=max(1, deadline-time.monotonic()))
            control("stop", "mysql", log)
            for round_number in (0, 1, 2):
                if time.monotonic() >= deadline:
                    status["state"] = "time_limit_incomplete"
                    break
                activate(log)
                if time.monotonic() >= deadline:
                    status["state"] = "time_limit_incomplete"
                    break
                seconds_left = max(0, deadline-time.monotonic())
                client("block", [*args, "--round", str(round_number),
                                 "--seconds-left", str(seconds_left)], log,
                       timeout=seconds_left+15)
                control("stop", "mysql", log)
            if status["state"] != "running":
                status["partial_cell"] = cell
                break
            combine(cell)
            status["completed_cells"].append(cell)
            status.pop("active_cell", None)
            write_json(status_path, status)
            print(json.dumps({"diagnostic_cell_complete": cell,
                              "elapsed_seconds": round(time.monotonic()-start, 1)}), flush=True)
        if status["state"] == "running":
            status["state"] = "complete"
    except (subprocess.TimeoutExpired, InterruptedRun, TimeLimitExceeded) as exc:
        status["state"] = "interrupted" if isinstance(exc, InterruptedRun) else "time_limit_incomplete"
        status["error_type"] = type(exc).__name__
        status["error"] = str(exc)[:1000]
        status["partial_cell"] = status.get("active_cell")
        if isinstance(exc, InterruptedRun):
            raise
    except Exception as exc:
        status["state"] = "time_limit_incomplete" if time.monotonic() >= deadline else "failed"
        status["error_type"] = type(exc).__name__
        status["error"] = str(exc)[:1000]
        status["partial_cell"] = status.get("active_cell")
        raise
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        try:
            stop_own_client(global_log)
            control("stop", "mysql", global_log)
            control("stop", "neo4j", global_log)
        except Exception as exc:
            status["cleanup_error"] = str(exc)[:500]
        status["finished_utc"] = utc_now()
        status["elapsed_seconds"] = time.monotonic() - start
        write_json(status_path, status)


def main() -> None:
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGALRM, time_limit)
    parser = argparse.ArgumentParser()
    parser.add_argument("group", choices=("main", "stress"))
    parser.add_argument("--authorized-after-parent-lease", action="store_true", required=True,
                        help="operator must hold the explicit root DB lease")
    args = parser.parse_args()
    if not args.authorized_after_parent_lease:
        parser.error("explicit DB lease required")
    run(args.group)


if __name__ == "__main__":
    main()
