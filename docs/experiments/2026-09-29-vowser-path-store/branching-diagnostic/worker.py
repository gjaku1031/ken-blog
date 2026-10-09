"""사후 ordered-membership 단독군. 원본 네 군의 타이밍/정답 함수를 재사용한다."""

from __future__ import annotations

import argparse
import csv
import json
import time
from collections import Counter
from pathlib import Path

import psutil

from branching import bench
from branching.model import Model, digest, stable_json, FIELDS
from branching.storage import load_mysql, mysql_statement, verify_engine_membership
from shared.connect import mysql_connection
from manifest import HERE, ROOT, verify, verify_cell

OUT = HERE / "results"
MODE = "mysql_member_ordered"


def worker_limits() -> dict:
    """실제 worker cgroup 상한을 검사하고 DB와 합산할 자원 계약에 남긴다."""
    cpu_path = Path("/sys/fs/cgroup/cpu.max")
    memory_path = Path("/sys/fs/cgroup/memory.max")
    if not cpu_path.exists() or not memory_path.exists():
        return {"cgroup_visible": False,
                "limit_source": "frozen shared/run-client.sh --cpus=1 --memory=1g"}
    cpu = cpu_path.read_text(encoding="utf-8").split()
    memory = memory_path.read_text(encoding="utf-8").strip()
    if cpu[0] == "max" or int(cpu[0]) != int(cpu[1]) or int(memory) != 1024**3:
        raise AssertionError(f"worker resource contract changed: cpu={cpu}, memory={memory}")
    return {"cgroup_visible": True, "cpu_max": cpu, "memory_max_bytes": int(memory)}


def ordered_statement(model: Model, case: dict) -> tuple[str, tuple]:
    original, params = mysql_statement("mysql_member", model.cell, case, model.depth_limit)
    marker = "SELECT e.path_id"
    if original.count(marker) != 1:
        raise AssertionError("original outer SELECT shape changed")
    sql = original.replace(marker, "SELECT STRAIGHT_JOIN e.path_id", 1)
    if sql.replace("SELECT STRAIGHT_JOIN e.path_id", marker, 1) != original:
        raise AssertionError("SQL differs beyond STRAIGHT_JOIN")
    return sql, params


def ordered_query(con, mode: str, cell: str, case: dict, depth_limit: int = 20) -> list[dict]:
    if mode != MODE or cell != ACTIVE_MODEL.cell or depth_limit != ACTIVE_MODEL.depth_limit:
        raise AssertionError("ordered worker called outside its single arm")
    sql, params = ordered_statement(ACTIVE_MODEL, case)
    with con.cursor() as cur:
        cur.execute(sql, params)
        raw = cur.fetchall()
    return [dict(zip(FIELDS, row)) for row in raw]


# A separate worker process runs only the posthoc arm. The original run_one
# still times query + full canonical JSON and checks the oracle afterward.
bench.mysql_query = ordered_query
ACTIVE_MODEL: Model


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def model_from_args(args: argparse.Namespace) -> Model:
    model = Model(args.total, args.share, args.cap, depth_override=args.depth)
    if model.cell not in verify()["cell_names"]:
        raise ValueError("cell outside frozen 20-cell matrix")
    verify_cell(model.cell)
    return model


def frozen_cases(model: Model) -> list[dict]:
    """원본 입력·200개 full-payload oracle를 동결된 Model과 전수 대조."""
    folder = ROOT / "branching" / "results" / model.cell
    saved = json.loads((folder / "input.json").read_text(encoding="utf-8"))
    cases = model.cases()
    expected_input = {"cell": model.cell, "seed": 20260929, "stats": model.stats(),
                      "cases": cases,
                      "oracle_manifest_sha256": digest([c["oracle_sha256"] for c in cases])}
    if saved != json.loads(stable_json(expected_input)) or len(cases) != 200:
        raise AssertionError("original input differs from generated cases")
    lines = (folder / "expected.jsonl").read_text(encoding="utf-8").splitlines()
    if len(lines) != len(cases):
        raise AssertionError("expected.jsonl must have all 200 cases")
    for case, line in zip(cases, lines, strict=True):
        expected = {"case_id": case["case_id"], "rows": model.oracle(case),
                    "sha256": case["oracle_sha256"]}
        if stable_json(json.loads(line)) != stable_json(expected):
            raise AssertionError(f"original oracle differs at case {case['case_id']}")
    return cases


def connection():
    con = mysql_connection()
    with con.cursor() as cur:
        cur.execute("SET SESSION MAX_EXECUTION_TIME=2000")
    return con


def plan_for(con, model: Model, case: dict) -> dict:
    sql, params = ordered_statement(model, case)
    record = {"case_id": case["case_id"], "expected_paths": case["oracle_paths"],
              "checks": {}, "passed": False, "plan": None}
    try:
        with con.cursor() as cur:
            cur.execute("EXPLAIN FORMAT=JSON " + sql, params)
            raw_plan = cur.fetchone()[0]
        record["raw_explain_json"] = raw_plan
        plan = json.loads(raw_plan)
        record["plan"] = plan
        loop = plan["query_block"]["ordering_operation"]["nested_loop"]
        tables = [item["table"] for item in loop]
        names = [item.get("table_name") for item in tables]
        member_parts = tables[1].get("used_key_parts", []) if len(tables) > 1 else []
        step_parts = tables[2].get("used_key_parts", []) if len(tables) > 2 else []
        checks = {
            "outer_join_order_e_m_s": names == ["e", "m", "s"],
            "eligible_materialized": bool(tables and "materialized_from_subquery" in tables[0]),
            "member_ref_condition_path": len(tables) > 1 and
                tables[1].get("access_type") == "ref" and
                tables[1].get("key") in ("PRIMARY", "br3_member_path_step") and
                member_parts[:2] == ["condition_id", "path_id"],
            "step_eq_ref_primary_condition_step": len(tables) > 2 and
                tables[2].get("access_type") == "eq_ref" and tables[2].get("key") == "PRIMARY" and
                step_parts[:2] == ["condition_id", "step_id"],
        }
        record["checks"] = checks
        record["passed"] = all(checks.values())
    except Exception as exc:
        record["guard_error_type"] = type(exc).__name__
        record["guard_error"] = str(exc)[:500]
    return record


def health() -> None:
    limits = worker_limits()
    con = connection()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT 1")
            if cur.fetchone()[0] != 1:
                raise AssertionError("authenticated MySQL health failed")
    finally:
        con.close()
    print(json.dumps({"engine": "mysql", "health": "ready", "worker_limits": limits}), flush=True)


def prepare(model: Model) -> None:
    limits = worker_limits()
    cases = frozen_cases(model)
    out = OUT / model.cell
    out.mkdir(parents=True, exist_ok=True)
    if (out / "prepare.json").exists():
        raise FileExistsError("diagnostic prepare already recorded")
    started = time.monotonic()
    loaded = load_mysql(model)
    expected_counts = {"br3_path": len(model.paths), "br3_step": len(model.steps),
                       "br3_member": len(model.members), "br3_next": len(model.next_edges)}
    if loaded["counts"] != expected_counts:
        raise AssertionError("full fixture counts mismatch")
    verified = verify_engine_membership(model, "mysql")
    answerable = next((c for c in cases if c["oracle_paths"] == 3), None)
    empty = next((c for c in cases if c["oracle_paths"] == 0), None)
    if answerable is None or empty is None:
        raise AssertionError("plan representatives missing")
    con = connection()
    try:
        plans = {"answerable": plan_for(con, model, answerable),
                 "empty": plan_for(con, model, empty)}
    finally:
        con.close()
    write_json(out / "plans.json", plans)
    if not plans["answerable"]["passed"]:
        write_json(out / "prepare.json", {"cell": model.cell,
            "state": "plan_guard_failed", "loaded": loaded,
            "full_membership": verified, "seconds": time.monotonic() - started,
            "worker_limits": limits})
        raise AssertionError("ordered outer plan guard failed; no arbitrary retuning")
    con = connection()
    smoke_failures = []
    try:
        for case in cases:
            row = bench.run_one(model, case, MODE, con, None, "smoke", -1)
            if not row["correct"]:
                smoke_failures.append(row)
            if not con.open:
                con.close()
                con = connection()
    finally:
        con.close()
    write_json(out / "smoke.json", {"cell": model.cell, "attempts": len(cases),
        "correct": len(cases) - len(smoke_failures), "failures": smoke_failures,
        "measured": False})
    state = "ready" if not smoke_failures else "smoke_failed"
    write_json(out / "prepare.json", {"cell": model.cell, "state": state,
        "loaded": loaded, "full_membership": verified,
        "seconds": time.monotonic() - started, "worker_limits": limits})
    if smoke_failures:
        raise AssertionError(f"full-payload smoke failed {len(smoke_failures)}/200")
    print(json.dumps({"cell": model.cell, "prepare": "ready",
                      "smoke_correct": len(cases)}), flush=True)


def block(model: Model, round_number: int, seconds_left: float) -> None:
    limits = worker_limits()
    if round_number not in (0, 1, 2):
        raise ValueError("round outside 0..2")
    cases = frozen_cases(model)
    out = OUT / model.cell
    if json.loads((out / "prepare.json").read_text())["state"] != "ready":
        raise AssertionError("plan/full-payload smoke not ready")
    path = out / f"raw-r{round_number}.csv"
    summary_path = out / f"round-r{round_number}.json"
    deadline = time.monotonic() + max(0, seconds_left)
    counts = Counter()
    failures = Counter()
    con = connection()
    peak_rss = 0
    try:
        with path.open("x", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=bench.RAW_FIELDS)
            writer.writeheader()
            for phase in ("warmup", "measure"):
                for case in cases:
                    if time.monotonic() >= deadline:
                        break
                    if not con.open:
                        con.close()
                        con = connection()
                    row = bench.run_one(model, case, MODE, con, None, phase, round_number)
                    writer.writerow(row)
                    counts[phase] += 1
                    failures[(phase, row["error_type"])] += not row["correct"]
                    peak_rss = max(peak_rss, psutil.Process().memory_info().rss)
                file.flush()
                if counts[phase] != 200:
                    break
    finally:
        con.close()
    summary = {"cell": model.cell, "round": round_number, "mode": MODE,
        "counts": dict(counts), "failures": {str(k): v for k, v in failures.items() if v},
        "complete": counts["warmup"] == counts["measure"] == 200,
        "worker_peak_sampled_rss_bytes": peak_rss, "worker_limits": limits}
    write_json(summary_path, summary)
    if not summary["complete"]:
        raise RuntimeError("round incomplete; attempts remain in raw denominator")
    print(json.dumps(summary), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("health", "prepare", "block"))
    parser.add_argument("--total", type=int)
    parser.add_argument("--share", type=int)
    parser.add_argument("--cap", type=int)
    parser.add_argument("--depth", type=int)
    parser.add_argument("--round", type=int, default=0)
    parser.add_argument("--seconds-left", type=float, default=3600)
    args = parser.parse_args()
    if args.command == "health":
        health()
        return
    if None in (args.total, args.share, args.cap):
        parser.error("prepare/block require --total --share --cap")
    global ACTIVE_MODEL
    ACTIVE_MODEL = model_from_args(args)
    if args.command == "prepare":
        prepare(ACTIVE_MODEL)
    else:
        block(ACTIVE_MODEL, args.round, args.seconds_left)


if __name__ == "__main__":
    main()
