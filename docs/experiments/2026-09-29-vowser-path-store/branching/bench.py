"""실험 3 준비/스모크/본측정. 본측정은 부모의 DB lease 후 실행."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import shutil
from datetime import datetime, timezone
from pathlib import Path

from shared.connect import mysql_connection, neo4j_driver

from branching.model import Model, digest, stable_json
from branching.storage import (
    NEO_ADJACENCY, NEO_MEMBERSHIP, load_mysql, load_neo, mysql_query,
    mysql_statement, neo_query, verify_full_membership,
)

HERE = Path(__file__).resolve().parent
OUT = HERE / "results"
ROOT = HERE.parent
SOURCE_SHA256 = "153593f35d9d32aad2416dd8efddc63629a1d2b0047a9bcfb74dd3add3a94e58"
DATA_SHA256 = "b65551b2a388dfbe80e811dddfd385e6f5245ebc5d2204f7171270c498e4855e"
MODES = ("neo_adj", "mysql_adj", "neo_member", "mysql_member")
RAW_FIELDS = (
    "cell", "phase", "round", "mode", "case_id", "scenario", "source_path", "target_depth",
    "blocked_count", "expected_paths", "expected_rows", "expected_sha256",
    "result_paths", "result_rows",
    "result_sha256", "result_bytes", "elapsed_ms", "correct", "error_type", "error",
    "mismatch_codes", "observed_json_if_wrong",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+"\n")


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def preflight(kind: str) -> None:
    host = json.loads((OUT/"host-preflight.json").read_text())
    source_sha = host["source_sha256"]
    data_sha = file_sha256(ROOT/"shared/data.py")
    if source_sha != SOURCE_SHA256 or data_sha != DATA_SHA256:
        raise AssertionError(f"source/shared data hash changed: {source_sha}, {data_sha}")
    head = host["agent_server_head"]
    if head != "d94eaf5f30f734952838528d7045e0eab8891509":
        raise AssertionError(f"agent-server HEAD changed: {head}")
    hashes = {name:file_sha256(HERE/name) for name in
              ("PROTOCOL.md","model.py","storage.py","bench.py","worker.py",
               "orchestrate.py","host_preflight.py","run.sh","managed.sh")}
    record = {"utc":utc_now(),"kind":kind,"agent_server_head":head,
              "source_sha256":source_sha,"shared_data_sha256":data_sha,
              "experiment_file_sha256":hashes,"python":sys.version}
    path = OUT/("preflight-"+kind+".json")
    if path.exists():
        previous = json.loads(path.read_text())
        if any(previous.get(key) != record.get(key) for key in
               ("agent_server_head","source_sha256","shared_data_sha256","experiment_file_sha256")):
            raise AssertionError(f"preflight source changed during {kind} run")
    else:
        write_json(path,record)
    shutil.copy2(ROOT/"shared/environment.json",OUT/"shared-environment.json")


def plan_tree(plan):
    if plan is None:
        return None
    if isinstance(plan,dict):
        return {str(k):plan_tree(v) for k,v in plan.items()}
    if isinstance(plan,(list,tuple)):
        return [plan_tree(v) for v in plan]
    if isinstance(plan,(str,int,float,bool)):
        return plan
    if not hasattr(plan,"operator_type"):
        return str(plan)
    return {
        "operator": plan.operator_type,
        "arguments": {str(k):str(v) for k,v in plan.arguments.items()},
        "identifiers": list(plan.identifiers),
        "children": [plan_tree(child) for child in plan.children],
        "db_hits": getattr(plan,"db_hits",None),
        "records": getattr(plan,"records",None),
    }


def capture_plans(model: Model, case: dict) -> dict:
    plans = {}
    con = mysql_connection()
    driver = neo4j_driver()
    try:
        with con.cursor() as cur:
            for mode in ("mysql_adj", "mysql_member"):
                sql, params = mysql_statement(mode,model.cell,case,model.depth_limit)
                cur.execute("EXPLAIN FORMAT=JSON " + sql,params)
                plans[mode] = json.loads(cur.fetchone()[0])
        with driver.session(database="neo4j") as session:
            for mode, query in (("neo_adj",NEO_ADJACENCY),("neo_member",NEO_MEMBERSHIP)):
                params = dict(cell=model.cell,domain=case["domain"],intent=case["intent"],
                              auth=case["auth"],blocked=case["blocked"])
                if mode == "neo_adj":
                    query = query.replace("{5,20}",f"{{5,{model.depth_limit}}}")
                plans[mode+"_explain"] = plan_tree(session.run("EXPLAIN "+query,**params).consume().plan)
                plans[mode+"_profile"] = plan_tree(session.run("PROFILE "+query,**params).consume().profile)
    finally:
        con.close()
        driver.close()
    return plans


def load_and_verify(model: Model, out: Path) -> tuple[list[dict], dict]:
    out.mkdir(parents=True,exist_ok=True)
    cases = model.cases()
    write_json(out/"input.json",{
        "cell":model.cell,"seed":20260929,"stats":model.stats(),
        "cases":cases,"oracle_manifest_sha256":digest([c["oracle_sha256"] for c in cases]),
    })
    with (out/"expected.jsonl").open("w") as file:
        for case in cases:
            file.write(stable_json({"case_id":case["case_id"],"rows":model.oracle(case),
                                    "sha256":case["oracle_sha256"]}).decode()+"\n")
    start = time.monotonic()
    mysql = load_mysql(model)
    neo = load_neo(model)
    counts = {
        "mysql":{"br3_path":len(model.paths),"br3_step":len(model.steps),
                 "br3_member":len(model.members),"br3_next":len(model.next_edges)},
        "neo4j":{"paths":len(model.paths),"steps":len(model.steps),
                  "members":len(model.members),"next_edges":len(model.next_edges)},
    }
    if mysql["counts"] != counts["mysql"] or neo["counts"] != counts["neo4j"]:
        raise AssertionError(f"load count mismatch: {mysql} {neo} {counts}")
    membership = verify_full_membership(model)
    meta = {"cell":model.cell,"mysql":mysql,"neo4j":neo,
            "full_membership":membership,"load_verify_seconds":time.monotonic()-start,
            "verified_utc":utc_now()}
    write_json(out/"load-verification.json",meta)
    write_json(out/"plans.json",capture_plans(model,cases[0]))
    return cases,meta


def run_one(model: Model, case: dict, mode: str, mysql, neo, phase: str, round_number: int) -> dict:
    start = time.perf_counter_ns()
    error_type = error = ""
    observed_json_if_wrong = ""
    mismatch_codes = ""
    result_paths = result_rows = result_bytes = 0
    result_sha = ""
    correct = False
    try:
        if mode.startswith("mysql"):
            rows = mysql_query(mysql,mode,model.cell,case,model.depth_limit)
        else:
            rows = neo_query(neo,mode,model.cell,case,model.depth_limit)
        payload = stable_json(rows)
        # 공통 기능 경계: root 탐색부터 전체 반환 필드의 canonical JSON 생성까지.
        elapsed_ms = (time.perf_counter_ns()-start)/1e6
        result_rows = len(rows)
        result_paths = len({row["path_id"] for row in rows})
        result_bytes = len(payload)
        result_sha = hashlib.sha256(payload).hexdigest()
        correct = result_sha == case["oracle_sha256"]
        if not correct:
            error_type = "WrongResult"
            error = f"expected {case['oracle_sha256']} got {result_sha}"
            observed_json_if_wrong = payload.decode()
            codes = []
            if any(row.get("step_id") in case["blocked"] for row in rows):
                codes.append("blocked_step_returned")
            if any(row.get("path_id") not in model.paths or
                   (row.get("domain"),row.get("intent"),row.get("auth")) !=
                   (case["domain"],case["intent"],case["auth"]) for row in rows):
                codes.append("wrong_context_or_unregistered_path")
            actual_paths = list(dict.fromkeys(row.get("path_id") for row in rows))
            expected_paths = list(dict.fromkeys(row["path_id"] for row in model.oracle(case)))
            if actual_paths != expected_paths:
                codes.append("selection_or_rank")
            for path_id in actual_paths:
                if path_id in model.path_steps:
                    actual_steps = [row.get("step_id") for row in rows if row.get("path_id") == path_id]
                    if actual_steps != model.path_steps[path_id]:
                        codes.append("path_splice_or_order")
                        break
            if not codes:
                codes.append("payload_field_mismatch")
            mismatch_codes = ",".join(codes)
    except Exception as exc:
        elapsed_ms = (time.perf_counter_ns()-start)/1e6
        error_type = type(exc).__name__
        error = str(exc)[:500]
    return {
        "cell":model.cell,"phase":phase,"round":round_number,"mode":mode,
        "case_id":case["case_id"],"scenario":case["scenario"],
        "source_path":case["source_path"],"target_depth":case.get("target_depth"),
        "blocked_count":len(case["blocked"]),
        "expected_paths":case["oracle_paths"],"expected_rows":case["oracle_rows"],
        "expected_sha256":case["oracle_sha256"],
        "result_paths":result_paths,"result_rows":result_rows,
        "result_sha256":result_sha,"result_bytes":result_bytes,
        "elapsed_ms":round(elapsed_ms,3),"correct":correct,
        "error_type":error_type,"error":error,"mismatch_codes":mismatch_codes,
        "observed_json_if_wrong":observed_json_if_wrong,
    }


def oracle_exhaustive_cases(model: Model) -> list[dict]:
    """작은 smoke 전체 context와 source 경로를 대상으로 차단 조합 검증."""
    from collections import Counter as C
    uses = C(step for ids in model.path_steps.values() for step in ids)
    cases = []
    for context,paths in sorted(model.contexts.items()):
        for path_id in paths:
            private = next(s for s in model.path_steps[path_id] if uses[s] == 1)
            cases.append({"domain":context[0],"intent":context[1],"auth":context[2],
                          "blocked":[private],"source_path":path_id,"scenario":"alternate"})
        all_private = [next(s for s in model.path_steps[p] if uses[s] == 1) for p in paths]
        cases.append({"domain":context[0],"intent":context[1],"auth":context[2],
                      "blocked":all_private,"source_path":None,"scenario":"none"})
        all_auth = sorted({model.path_steps[p][-1] for p in paths})
        cases.append({"domain":context[0],"intent":context[1],"auth":context[2],
                      "blocked":all_auth,"source_path":None,"scenario":"auth"})
    for index,case in enumerate(cases):
        case["case_id"] = index
        expected = model.oracle(case)
        case["oracle_rows"] = len(expected)
        case["oracle_paths"] = len({row["path_id"] for row in expected})
        case["oracle_sha256"] = digest(expected)
    return cases


def run_smoke(stress: bool = False) -> None:
    preflight("smoke-stress" if stress else "smoke")
    model = Model(360,50,4,depth_override=100) if stress else Model(720,50,4)
    out = OUT/("smoke-stress-"+model.cell if stress else "smoke-v2-"+model.cell)
    cases,meta = load_and_verify(model,out)
    exhaustive = cases if stress else oracle_exhaustive_cases(model)
    con = mysql_connection()
    driver = neo4j_driver()
    errors = []
    try:
        with con.cursor() as cur:
            cur.execute("SET SESSION MAX_EXECUTION_TIME=2000")
        with driver.session(database="neo4j") as session:
            for case in exhaustive:
                for mode in MODES:
                    row = run_one(model,case,mode,con,session,"smoke",0)
                    if not row["correct"]:
                        errors.append(row)
        result = {"cell":model.cell,"cases":len(exhaustive),"attempts":len(exhaustive)*4,
                  "errors":errors,"stats":model.stats(),"verified_utc":utc_now()}
        write_json(out/"smoke.json",result)
        if errors:
            raise AssertionError(f"smoke {len(errors)} mismatches; see {out/'smoke.json'}")
        print(json.dumps({"smoke":"pass","cases":len(exhaustive),"attempts":len(exhaustive)*4,
                          "max_outdegree":model.stats()["max_outdegree"]}))
    finally:
        con.close()
        driver.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command",choices=("model","smoke","smoke-stress"))
    parser.add_argument("--total",type=int,default=1000)
    parser.add_argument("--share",type=int,default=25)
    parser.add_argument("--cap",type=int,default=2)
    parser.add_argument("--depth",type=int,default=None)
    args = parser.parse_args()
    if args.command == "model":
        model = Model(args.total,args.share,args.cap,depth_override=args.depth)
        print(json.dumps({"stats":model.stats(),"cases":len(model.cases())},ensure_ascii=False))
    elif args.command in ("smoke","smoke-stress"):
        run_smoke(stress=args.command == "smoke-stress")


if __name__ == "__main__":
    main()
