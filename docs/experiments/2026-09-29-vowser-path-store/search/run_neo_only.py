#!/usr/bin/env python3
"""30k uniform OOM 뒤 고정 설정 Neo4j 30k/skew 1회 적재·조건부 측정."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from search.freeze import sha256, verify
from search.run_config import HERE, db_control, utc, wait_driver_ready, worker


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", required=True)
    parser.add_argument("--authorized-by-parent", action="store_true")
    args = parser.parse_args()
    if not args.authorized_by_parent:
        parser.error("parent approved fixed-config continuation required")
    verify()
    runs, logs = HERE / "runs", HERE / "logs"
    runs.mkdir(exist_ok=True)
    logs.mkdir(exist_ok=True)
    schedule = runs / f"{args.label}.schedule.jsonl"
    if schedule.exists():
        raise RuntimeError("schedule already exists")
    base = f"{args.label}_neo_skew_30000"
    with schedule.open("x", encoding="utf-8") as events:
        events.write(json.dumps({"kind": "header", "utc": utc(), "backend": "neo", "n": 30000,
                                 "distribution": "skew", "same_fixed_loader_and_db_limit": True,
                                 "one_load_attempt_after_uniform_oom": True,
                                 "no_paired_crossover_due_to_uniform_load_failure": True,
                                 "measurement_source_freeze_sha256": sha256(HERE / "freeze_manifest.json"),
                                 "orchestrator_sha256": sha256(Path(__file__))}, sort_keys=True) + "\n")
        db_control("stop", "mysql", logs / f"{args.label}_stop_mysql.log", events, {"round": -1})
        db_control("start", "neo", logs / f"{args.label}_start_neo.log", events, {"round": -1})
        db_control("ready", "neo", logs / f"{args.label}_ready_neo.log", events, {"round": -1})
        wait_driver_ready("neo", logs / f"{args.label}_auth_neo.log", events, -1)
        worker(["search.load_data", "--backend", "neo", "--n", "30000",
                "--distribution", "skew", "--label", base],
               logs / f"{args.label}_load.log", events,
               {"step": "load", "backend": "neo", "round": -1})
        worker(["search.run_measure", "calibrate", "--backend", "neo", "--n", "30000",
                "--distribution", "skew", "--label", base],
               logs / f"{args.label}_calibrate.log", events,
               {"step": "calibrate_train_only", "backend": "neo", "round": -1})
        for round_id in range(3):
            worker(["search.run_measure", "measure", "--backend", "neo", "--n", "30000",
                    "--distribution", "skew", "--label", f"{base}_r{round_id}",
                    "--round-index", str(round_id),
                    "--calibration", f"/work/search/runs/{base}.calibration.json"],
                   logs / f"{args.label}_r{round_id}_measure.log", events,
                   {"step": "measure", "backend": "neo", "round": round_id})
            db_control("stats", "neo", logs / f"{args.label}_r{round_id}_stats.log", events,
                       {"round": round_id})
        db_control("stop", "neo", logs / f"{args.label}_final_stop.log", events, {"round": 3})
    print(json.dumps({"status": "neo_only_complete", "schedule": str(schedule),
                      "sha256": sha256(schedule)}, sort_keys=True))


if __name__ == "__main__":
    main()
