#!/usr/bin/env python3
"""검색 측정 종료 후 DB를 읽기 전용으로 조사하는 부속 증거 수집."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from shared.connect import mysql_connection, neo4j_driver
from search.build_inputs import ASSETS, checksum
from search.search_adapters import (
    NEO_OPTIMIZED_HINTED, NEO_OPTIMIZED_UNHINTED,
    NEO_ORIGINAL_HINTED, NEO_ORIGINAL_PATH, NEO_ORIGINAL_UNHINTED,
)

HERE = Path(__file__).resolve().parent


def neo() -> dict:
    driver = neo4j_driver()
    try:
        with driver.session() as session:
            counts = session.run("MATCH (r:SR1_ROOT) WITH count(r) AS roots MATCH (s:SR1_STEP) WITH roots,count(s) AS steps MATCH ()-[h:SR1_HAS_STEP]->() WITH roots,steps,count(h) AS paths MATCH ()-[e:SR1_NEXT_STEP]->() RETURN roots,steps,paths,count(e) AS edges").single().data()
            indexes = session.run("SHOW INDEXES YIELD name,type,state,labelsOrTypes,properties WHERE name STARTS WITH 'sr1_' RETURN name,type,state,labelsOrTypes,properties").data()
            constraints = session.run("SHOW CONSTRAINTS YIELD name,type,labelsOrTypes,properties WHERE name STARTS WITH 'sr1_' RETURN name,type,labelsOrTypes,properties").data()
            vector = np.asarray(np.load(ASSETS / "queries_skew.npy", mmap_mode="r")[10], dtype=np.float32).astype(float).tolist()
            plans = {}
            for name, query, extra in (
                ("original_unhinted", NEO_ORIGINAL_UNHINTED, {}),
                ("original_hinted", NEO_ORIGINAL_HINTED, {"domain": "d00.example.test"}),
                ("original_path", NEO_ORIGINAL_PATH, {"startStepId": "0" * 32}),
                ("optimized_unhinted", NEO_OPTIMIZED_UNHINTED, {}),
                ("optimized_hinted", NEO_OPTIMIZED_HINTED, {"domain": "d00.example.test"}),
            ):
                params = {"topK": 30, "limit": 3, "queryEmbedding": vector, **extra}
                plan = session.run("EXPLAIN " + query, **params).consume().plan
                plans[name] = str(plan)
        return {"counts": counts, "indexes": indexes, "constraints": constraints, "explain_plans": plans}
    finally:
        driver.close()


def mysql() -> dict:
    connection = mysql_connection()
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT table_name,table_rows,data_length,index_length,data_free FROM information_schema.TABLES WHERE table_schema=DATABASE() AND table_name LIKE 'sr1_%' ORDER BY table_name")
            tables = [dict(zip(("table_name", "estimated_rows", "data_length", "index_length", "data_free"), row)) for row in cur.fetchall()]
            cur.execute("SELECT (SELECT count(*) FROM sr1_root),(SELECT count(*) FROM sr1_path),(SELECT count(*) FROM sr1_step)")
            roots, paths, steps = cur.fetchone()
            indexes = {}
            for table in ("sr1_root", "sr1_path", "sr1_step"):
                cur.execute(f"SHOW INDEX FROM {table}")
                columns = [item[0] for item in cur.description]
                indexes[table] = [dict(zip(columns, row)) for row in cur.fetchall()]
            cur.execute("EXPLAIN FORMAT=JSON SELECT p.path_id,r.domain,p.task_intent,p.weight,s.ordinal,s.url,s.action,s.selectors,s.description,s.is_input,s.input_type,s.input_placeholder,s.should_wait,s.wait_message,s.text_labels FROM sr1_path p JOIN sr1_root r ON p.domain_id=r.domain_id JOIN sr1_step s ON s.path_id=p.path_id WHERE p.path_id IN (0,1,2) ORDER BY p.path_id,s.ordinal")
            plan = json.loads(cur.fetchone()[0])
            try:
                cur.execute("SELECT name,file_size,allocated_size FROM information_schema.INNODB_TABLESPACES WHERE name LIKE 'vowser_eval_v2/sr1_%' ORDER BY name")
                tablespaces = [dict(zip(("name", "file_size", "allocated_size"), row)) for row in cur.fetchall()]
            except Exception as error:
                tablespaces = {"error_type": type(error).__name__, "error": str(error)[:300]}
        return {"counts": {"roots": roots, "paths": paths, "steps": steps,
                           "logical_edges": steps-paths}, "tables": tables,
                "indexes": indexes, "explain_plan": plan, "tablespaces": tablespaces}
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("neo", "mysql"), required=True)
    parser.add_argument("--label", required=True)
    args = parser.parse_args()
    target_dir = HERE / "evidence"
    target_dir.mkdir(exist_ok=True)
    output = target_dir / f"{args.label}_{args.backend}.json"
    if output.exists():
        raise RuntimeError("evidence already exists")
    result = neo() if args.backend == "neo" else mysql()
    record = {"backend": args.backend, "method": "read-only after official search measurement",
              "collector_sha256": checksum(Path(__file__)), "result": result}
    output.write_text(json.dumps(record, ensure_ascii=False, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8")
    print(json.dumps({"backend": args.backend, "output": str(output), "sha256": checksum(output),
                      "counts": result["counts"]}, sort_keys=True))


if __name__ == "__main__":
    main()
