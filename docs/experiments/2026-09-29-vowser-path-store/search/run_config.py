#!/usr/bin/env python3
"""승인된 한 규모·분포의 Neo/MySQL 단독 기동과 3회 교차 측정."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import time

from search.freeze import sha256

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CONTROL = ROOT / "shared/db-control.sh"
CLIENT = ROOT / "shared/run-client.sh"


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_step(command: list[str], log: Path, events, detail: dict) -> None:
    start = time.perf_counter()
    with log.open("x", encoding="utf-8") as stream:
        completed = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT,
                                   stdin=subprocess.DEVNULL, check=False)
    event = {"utc": utc(), "command": command, "exit_code": completed.returncode,
             "wall_seconds": round(time.perf_counter()-start, 3), "log": str(log), **detail}
    events.write(json.dumps(event, sort_keys=True) + "\n")
    events.flush()
    if completed.returncode:
        raise RuntimeError(f"step failed: {detail}; log={log}")


def db_control(action: str, backend: str, log: Path, events, detail: dict) -> None:
    db_kind = "neo4j" if backend == "neo" else "mysql"
    run_step(["bash", str(CONTROL), action, db_kind], log, events,
             {"step": f"db_{action}", "backend": backend, **detail})


def worker(args: list[str], log: Path, events, detail: dict) -> None:
    module_flag = [] if args[0] == "-c" else ["-m"]
    run_step(["bash", str(CLIENT), "env", "PYTHONPATH=/work:/work/search", "python", *module_flag, *args],
             log, events, detail)


def wait_driver_ready(backend: str, log: Path, events, round_id: int) -> None:
    if backend == "neo":
        probe = "from shared.connect import neo4j_driver; d=neo4j_driver(); s=d.session(); assert s.run('RETURN 1 AS ok').single()['ok']==1; s.close(); d.close()"
    else:
        probe = "from shared.connect import mysql_connection; c=mysql_connection(); cur=c.cursor(); cur.execute('SELECT 1'); assert cur.fetchone()[0]==1; cur.close(); c.close()"
    command = ["bash", str(CLIENT), "env", "PYTHONPATH=/work:/work/search", "python", "-c", probe]
    started = time.perf_counter()
    last_error = None
    attempts = 0
    while time.perf_counter() - started < 90:
        attempts += 1
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                                stdin=subprocess.DEVNULL, check=False)
        if result.returncode == 0:
            log.write_text(json.dumps({"attempts": attempts, "driver_query": "RETURN 1" if backend == "neo" else "SELECT 1",
                                       "last_transient_error": last_error}, sort_keys=True) + "\n", encoding="utf-8")
            events.write(json.dumps({"step": "driver_ready", "backend": backend, "round": round_id,
                                     "utc": utc(), "attempts": attempts, "exit_code": 0,
                                     "wall_seconds": round(time.perf_counter()-started, 3),
                                     "log": str(log)}, sort_keys=True) + "\n")
            events.flush()
            return
        lines = (result.stderr or result.stdout).strip().splitlines()
        last_error = lines[-1][:400] if lines else f"worker exit {result.returncode} without output"
        time.sleep(1)
    log.write_text(json.dumps({"attempts": attempts, "last_error": last_error}, sort_keys=True) + "\n", encoding="utf-8")
    events.write(json.dumps({"step": "driver_ready", "backend": backend, "round": round_id,
                             "utc": utc(), "attempts": attempts, "exit_code": 1,
                             "wall_seconds": round(time.perf_counter()-started, 3),
                             "log": str(log)}, sort_keys=True) + "\n")
    events.flush()
    raise RuntimeError(f"driver did not become query-ready in 90s: {backend}; log={log}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, choices=(1000, 10000, 30000), required=True)
    parser.add_argument("--distribution", choices=("uniform", "skew"), required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--authorized-by-parent", action="store_true")
    args = parser.parse_args()
    if not args.authorized_by_parent:
        parser.error("official measurement requires explicit parent order approval")
    from search.freeze import verify
    verify()
    logs = HERE / "logs"
    runs = HERE / "runs"
    logs.mkdir(exist_ok=True)
    runs.mkdir(exist_ok=True)
    schedule = runs / f"{args.label}.schedule.jsonl"
    if schedule.exists():
        raise RuntimeError(f"schedule already exists: {schedule}")
    first = "neo" if ((1000, 10000, 30000).index(args.n) + (args.distribution == "skew")) % 2 == 0 else "mysql"
    other = "mysql" if first == "neo" else "neo"
    orders = ((first, other), (other, first), (first, other))
    loaded, calibrated = set(), set()
    active = None
    with schedule.open("x", encoding="utf-8") as events:
        events.write(json.dumps({"kind": "header", "utc": utc(), "n": args.n,
                                 "distribution": args.distribution, "orders": orders,
                                 "freeze_sha256": sha256(HERE / "freeze_manifest.json")}, sort_keys=True) + "\n")
        for round_id, order in enumerate(orders):
            for backend in order:
                prefix = f"{args.label}_{backend}_r{round_id}"
                opposite = "mysql" if backend == "neo" else "neo"
                if active != backend:
                    db_control("stop", opposite, logs / f"{prefix}_stop_other.log", events,
                               {"round": round_id})
                    db_control("start", backend, logs / f"{prefix}_start.log", events,
                               {"round": round_id})
                db_control("ready", backend, logs / f"{prefix}_ready.log", events,
                           {"round": round_id})
                # TCP 열림 뒤 실제 인증·RETURN/SELECT 1 성공까지 최대 90초 재시도.
                wait_driver_ready(backend, logs / f"{prefix}_auth.log", events, round_id)
                active = backend
                base = f"{args.label}_{backend}_{args.distribution}_{args.n}"
                if backend not in loaded:
                    worker(["search.load_data", "--backend", backend, "--n", str(args.n),
                            "--distribution", args.distribution, "--label", base],
                           logs / f"{prefix}_load.log", events,
                           {"step": "load", "backend": backend, "round": round_id})
                    loaded.add(backend)
                if backend not in calibrated:
                    worker(["search.run_measure", "calibrate", "--backend", backend,
                            "--n", str(args.n), "--distribution", args.distribution,
                            "--label", base], logs / f"{prefix}_calibrate.log", events,
                           {"step": "calibrate_train_only", "backend": backend, "round": round_id})
                    calibrated.add(backend)
                worker(["search.run_measure", "measure", "--backend", backend,
                        "--n", str(args.n), "--distribution", args.distribution,
                        "--label", f"{base}_r{round_id}", "--round-index", str(round_id),
                        "--calibration", f"/work/search/runs/{base}.calibration.json"],
                       logs / f"{prefix}_measure.log", events,
                       {"step": "measure", "backend": backend, "round": round_id})
                db_control("stats", backend, logs / f"{prefix}_stats.log", events,
                           {"round": round_id})
        if active is not None:
            db_control("stop", active, logs / f"{args.label}_final_stop.log", events,
                       {"round": 3})
    print(json.dumps({"status": "config_complete", "schedule": str(schedule),
                      "sha256": sha256(schedule)}, sort_keys=True))


if __name__ == "__main__":
    main()
