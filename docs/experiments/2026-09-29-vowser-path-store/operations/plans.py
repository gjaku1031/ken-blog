#!/usr/bin/env python3
"""운영 실험 인덱스·대표 읽기/쓰기 EXPLAIN과 저장량 근거 수집."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import pymysql

from shared.connect import mysql_connection, neo4j_driver

HERE = Path(__file__).resolve().parent
TABLES = ("op2_root", "op2_has_step", "op2_step", "op2_next_step")


def mysql_plans():
    conn = mysql_connection()
    result = {"backend": "mysql", "time_utc": datetime.now(timezone.utc).isoformat(),
              "plans": {}, "indexes": {}, "table_bytes_approx": []}
    statements = {
        "popular": ("""SELECT h.path_id,h.domain,h.task_intent,h.weight,s.description
          FROM op2_has_step h JOIN op2_step s ON s.step_id=h.first_step_id
          WHERE h.domain=%s ORDER BY h.weight DESC,h.path_id ASC LIMIT 10""", ("d00.example.test",)),
        "visualize_membership": ("""SELECT path_id,task_intent,weight,depth FROM op2_has_step
          WHERE domain=%s ORDER BY weight DESC,path_id ASC LIMIT 10""", ("d00.example.test",)),
        "visualize_steps": ("""SELECT path_id,description FROM op2_step
          WHERE path_id IN (%s,%s,%s) ORDER BY path_id,ordinal""", (0, 1, 2)),
        "update_root": ("""UPDATE op2_root AS r JOIN op2_has_step AS h
          ON h.domain=r.domain SET r.visit_count=r.visit_count+1
          WHERE h.path_id=%s""", (0,)),
        "update_has": ("UPDATE op2_has_step SET weight=weight+1 WHERE path_id=%s", (0,)),
        "update_steps": ("UPDATE op2_step SET usage_count=usage_count+1 WHERE path_id=%s", (0,)),
        "update_edges": ("UPDATE op2_next_step SET weight=weight+1 WHERE path_id=%s", (0,)),
    }
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            for key, (statement, params) in statements.items():
                try:
                    cur.execute("EXPLAIN FORMAT=JSON " + statement, params)
                    raw = next(iter(cur.fetchone().values()))
                    result["plans"][key] = json.loads(raw)
                except Exception as exc:
                    result["plans"][key] = {"error_type": type(exc).__name__,
                                            "error": str(exc)[:300]}
            for table in TABLES:
                cur.execute(f"SHOW INDEX FROM {table}")
                result["indexes"][table] = list(cur.fetchall())
            marks = ",".join(["%s"] * len(TABLES))
            cur.execute(f"""SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
              FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
              AND TABLE_NAME IN ({marks}) ORDER BY TABLE_NAME""", TABLES)
            result["table_bytes_approx"] = list(cur.fetchall())
    finally:
        conn.close()
    return result


def plan_tree(plan):
    if plan is None:
        return None
    if isinstance(plan, dict):
        return {str(key): plan_tree(value) for key, value in plan.items()}
    if isinstance(plan, (list, tuple)):
        return [plan_tree(value) for value in plan]
    if not hasattr(plan, "operator_type"):
        return plan
    return {"operator": plan.operator_type,
            "identifiers": list(plan.identifiers),
            "arguments": dict(plan.arguments),
            "children": [plan_tree(child) for child in plan.children]}


def neo4j_plans():
    driver = neo4j_driver()
    result = {"backend": "neo4j", "time_utc": datetime.now(timezone.utc).isoformat(),
              "plans": {}, "indexes": []}
    statements = {
        "popular": """MATCH (r:OP2_ROOT {domain:$domain})-[h:OP2_HAS_STEP]->(first:OP2_STEP)
          RETURN h.pathId AS path_id,r.domain AS domain,h.taskIntent AS taskIntent,
          h.weight AS usageCount,first.description AS firstStepDescription
          ORDER BY h.weight DESC,h.pathId ASC LIMIT 10""",
        "visualize": """MATCH (r:OP2_ROOT {domain:$domain})-[h:OP2_HAS_STEP]->(first:OP2_STEP)
          WITH h,first ORDER BY h.weight DESC,h.pathId ASC LIMIT 10
          OPTIONAL MATCH p=(first)-[:OP2_NEXT_STEP*0..10]->(last:OP2_STEP)
          WHERE NOT (last)-[:OP2_NEXT_STEP]->()
          RETURN h.pathId AS path_id,h.taskIntent AS taskIntent,h.weight AS weight,
            CASE WHEN p IS NULL THEN null ELSE [s IN nodes(p) | s.description] END AS steps,
            CASE WHEN p IS NULL THEN null ELSE length(p) END AS pathLength
          ORDER BY weight DESC,path_id ASC""",
        "update": """MATCH (r:OP2_ROOT)-[h:OP2_HAS_STEP {pathId:$path_id}]->(first:OP2_STEP)
          MATCH p=(first)-[:OP2_NEXT_STEP*0..20]->(end:OP2_STEP)
          WHERE NOT (end)-[:OP2_NEXT_STEP]->()
          SET r.visitCount=r.visitCount+1,h.weight=h.weight+1
          FOREACH (s IN nodes(p) | SET s.usageCount=s.usageCount+1)
          FOREACH (e IN relationships(p) | SET e.weight=e.weight+1)
          RETURN length(p) AS depth""",
    }
    try:
        with driver.session(database="neo4j") as session:
            for key, statement in statements.items():
                summary = session.run("EXPLAIN " + statement,
                                      domain="d00.example.test", path_id=0).consume()
                result["plans"][key] = plan_tree(summary.plan)
            result["indexes"] = [dict(row) for row in session.run("""SHOW INDEXES
              YIELD name,type,entityType,labelsOrTypes,properties,state
              WHERE name STARTS WITH 'op2_'
              RETURN name,type,entityType,labelsOrTypes,properties,state ORDER BY name""")]
    finally:
        driver.close()
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("mysql", "neo4j"), required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    result = mysql_plans() if args.backend == "mysql" else neo4j_plans()
    path = HERE / "results" / f"plans-{args.tag}-{args.backend}.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str) + "\n")
    print(f"wrote {path.name}")
