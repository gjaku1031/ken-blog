#!/usr/bin/env python3
"""Neo 30k 적재 OOM 후 동일 frozen workload의 MySQL 단독 3라운드."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from search.freeze import sha256, verify
from search.run_config import HERE, db_control, utc, wait_driver_ready, worker


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--distribution", choices=("uniform", "skew"), required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--authorized-by-parent", action="store_true")
    args = parser.parse_args()
    if not args.authorized_by_parent:
        parser.error("parent approved continuation required")
    verify()
    runs, logs = HERE / "runs", HERE / "logs"
    runs.mkdir(exist_ok=True)
    logs.mkdir(exist_ok=True)
    schedule = runs / f"{args.label}.schedule.jsonl"
    if schedule.exists():
        raise RuntimeError("schedule already exists")
    base = f"{args.label}_mysql_{args.distribution}_30000"
    with schedule.open("x", encoding="utf-8") as events:
        events.write(json.dumps({"kind": "header", "utc": utc(), "backend": "mysql", "n": 30000,
                                 "distribution": args.distribution,
                                 "paired_neo_status": "30k Neo load OOM; no paired search latency",
                                 "three_rounds": True,
                                 "measurement_source_freeze_sha256": sha256(HERE / "freeze_manifest.json"),
                                 "orchestrator_sha256": sha256(Path(__file__))}, sort_keys=True) + "\n")
        db_control("stop", "neo", logs / f"{args.label}_stop_neo.log", events, {"round": -1})
        db_control("start", "mysql", logs / f"{args.label}_start_mysql.log", events, {"round": -1})
        db_control("ready", "mysql", logs / f"{args.label}_ready_mysql.log", events, {"round": -1})
        wait_driver_ready("mysql", logs / f"{args.label}_auth_mysql.log", events, -1)
        worker(["search.load_data", "--backend", "mysql", "--n", "30000",
                "--distribution", args.distribution, "--label", base],
               logs / f"{args.label}_load.log", events,
               {"step": "load", "backend": "mysql", "round": -1})
        worker(["search.run_measure", "calibrate", "--backend", "mysql", "--n", "30000",
                "--distribution", args.distribution, "--label", base],
               logs / f"{args.label}_calibrate.log", events,
               {"step": "calibrate_train_only", "backend": "mysql", "round": -1})
        for round_id in range(3):
            worker(["search.run_measure", "measure", "--backend", "mysql", "--n", "30000",
                    "--distribution", args.distribution, "--label", f"{base}_r{round_id}",
                    "--round-index", str(round_id),
                    "--calibration", f"/work/search/runs/{base}.calibration.json"],
                   logs / f"{args.label}_r{round_id}_measure.log", events,
                   {"step": "measure", "backend": "mysql", "round": round_id})
            db_control("stats", "mysql", logs / f"{args.label}_r{round_id}_stats.log", events,
                       {"round": round_id})
        db_control("stop", "mysql", logs / f"{args.label}_final_stop.log", events, {"round": 3})
    print(json.dumps({"status": "mysql_only_complete", "schedule": str(schedule),
                      "sha256": sha256(schedule)}, sort_keys=True))


if __name__ == "__main__":
    main()
