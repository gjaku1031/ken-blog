#!/usr/bin/env python3
"""실험1 검색 전용 투영 모델을 새 v2 DB 한 곳에 재적재한다."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

import numpy as np

from shared.connect import mysql_connection, neo4j_driver
from shared.data import path_record
from search.build_inputs import ASSETS, checksum, validate as validate_inputs

HERE = Path(__file__).resolve().parent
LOADS = HERE / "loads"

NEO_CREATE_STEPS = """
UNWIND $steps AS st
CREATE (:SR1_STEP {
  stepId: st.stepId, pathId: st.pathId, ordinal: st.ordinal,
  url: st.url, action: st.action, selectors: st.selectors,
  description: st.description, isInput: st.isInput,
  inputType: st.inputType, inputPlaceholder: st.inputPlaceholder,
  shouldWait: st.shouldWait, waitMessage: st.waitMessage,
  textLabels: st.textLabels
})
"""
NEO_CREATE_HEADS = """
UNWIND $paths AS p
MATCH (r:SR1_ROOT {domain:p.domain})
MATCH (s:SR1_STEP {stepId:p.firstStepId})
CREATE (r)-[:SR1_HAS_STEP {
  pathId:p.pathId, taskIntent:p.taskIntent, weight:p.weight,
  intentEmbedding:p.intentEmbedding
}]->(s)
"""
NEO_CREATE_EDGES = """
UNWIND $edges AS e
MATCH (a:SR1_STEP {stepId:e.fromStepId})
MATCH (b:SR1_STEP {stepId:e.toStepId})
CREATE (a)-[:SR1_NEXT_STEP {pathId:e.pathId, sequenceOrder:e.sequenceOrder}]->(b)
"""


def neo_reset(driver) -> None:
    with driver.session() as session:
        session.run("DROP INDEX sr1_intent_embeddings IF EXISTS").consume()
        while True:
            deleted = session.run("MATCH (s:SR1_STEP) WITH s LIMIT 2000 DETACH DELETE s RETURN count(*) AS n").single()["n"]
            if not deleted:
                break
        while True:
            deleted = session.run("MATCH (r:SR1_ROOT) WITH r LIMIT 2000 DETACH DELETE r RETURN count(*) AS n").single()["n"]
            if not deleted:
                break
        session.run("CREATE CONSTRAINT sr1_root_domain IF NOT EXISTS FOR (r:SR1_ROOT) REQUIRE r.domain IS UNIQUE").consume()
        session.run("CREATE CONSTRAINT sr1_step_id IF NOT EXISTS FOR (s:SR1_STEP) REQUIRE s.stepId IS UNIQUE").consume()


def neo_batch(tx, heads: list[dict], steps: list[dict], edges: list[dict]) -> None:
    tx.run(NEO_CREATE_STEPS, steps=steps).consume()
    tx.run(NEO_CREATE_HEADS, paths=heads).consume()
    tx.run(NEO_CREATE_EDGES, edges=edges).consume()


def neo_load(n: int, distribution: str, matrix: np.ndarray) -> dict:
    driver = neo4j_driver()
    try:
        t0 = time.perf_counter()
        neo_reset(driver)
        with driver.session() as session:
            session.run("UNWIND $domains AS d CREATE (:SR1_ROOT {domain:d})", domains=[f"d{i:02d}.example.test" for i in range(30)]).consume()
            for start in range(0, n, 100):
                heads, steps, edges = [], [], []
                for pid in range(start, min(start + 100, n)):
                    path = path_record(pid, distribution)
                    pid = path["path_id"]
                    nodes = path["steps"]
                    heads.append({"pathId": pid, "domain": path["domain"], "taskIntent": path["intent"], "weight": 1, "firstStepId": nodes[0]["step_id"], "intentEmbedding": matrix[pid].astype(float).tolist()})
                    for st in nodes:
                        steps.append({"stepId": st["step_id"], "pathId": pid, "ordinal": st["ordinal"], "url": st["url"], "action": st["action"], "selectors": st["selectors"], "description": st["description"], "isInput": st["isInput"], "inputType": None, "inputPlaceholder": None, "shouldWait": st["shouldWait"], "waitMessage": None, "textLabels": st["textLabels"]})
                    for previous, current in zip(nodes, nodes[1:]):
                        edges.append({"fromStepId": previous["step_id"], "toStepId": current["step_id"], "pathId": pid, "sequenceOrder": current["ordinal"]})
                session.execute_write(neo_batch, heads, steps, edges)
        load_sec = time.perf_counter() - t0
        build_start = time.perf_counter()
        with driver.session() as session:
            session.run("CREATE VECTOR INDEX sr1_intent_embeddings IF NOT EXISTS FOR ()-[r:SR1_HAS_STEP]-() ON (r.intentEmbedding) OPTIONS {indexConfig: {`vector.dimensions`: 1536, `vector.similarity_function`: 'cosine'}}").consume()
            for _ in range(600):
                state = session.run("SHOW INDEXES YIELD name, state WHERE name='sr1_intent_embeddings' RETURN state").single()
                if state and state["state"] == "ONLINE":
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Neo4j vector index not ONLINE in 600s")
            counts = session.run("MATCH (s:SR1_STEP) WITH count(s) AS steps MATCH ()-[h:SR1_HAS_STEP]->() WITH steps,count(h) AS paths MATCH ()-[e:SR1_NEXT_STEP]->() RETURN steps,paths,count(e) AS edges").single().data()
        return {"load_seconds": round(load_sec, 3), "index_build_seconds": round(time.perf_counter() - build_start, 3), "counts": counts, "index_state": "ONLINE"}
    finally:
        driver.close()


MYSQL_SCHEMA = [
    "CREATE TABLE IF NOT EXISTS sr1_root (domain_id TINYINT UNSIGNED PRIMARY KEY, domain VARCHAR(64) NOT NULL UNIQUE) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS sr1_path (path_id INT PRIMARY KEY, domain_id TINYINT UNSIGNED NOT NULL, task_intent VARCHAR(32) NOT NULL, weight INT NOT NULL, first_step_id CHAR(32) NOT NULL, intent_embedding BLOB NOT NULL, KEY sr1_path_domain (domain_id), KEY sr1_path_first (first_step_id)) ENGINE=InnoDB",
    "CREATE TABLE IF NOT EXISTS sr1_step (step_id CHAR(32) PRIMARY KEY, path_id INT NOT NULL, ordinal SMALLINT UNSIGNED NOT NULL, url VARCHAR(255) NOT NULL, action VARCHAR(24) NOT NULL, selectors JSON NOT NULL, description VARCHAR(255) NOT NULL, is_input BOOLEAN NOT NULL, input_type VARCHAR(32) NULL, input_placeholder VARCHAR(255) NULL, should_wait BOOLEAN NOT NULL, wait_message VARCHAR(255) NULL, text_labels JSON NOT NULL, KEY sr1_step_path_ordinal (path_id,ordinal)) ENGINE=InnoDB",
]


def mysql_load(n: int, distribution: str, matrix: np.ndarray) -> dict:
    conn = mysql_connection()
    try:
        started = time.perf_counter()
        with conn.cursor() as cur:
            for sql in MYSQL_SCHEMA:
                cur.execute(sql)
            cur.execute("TRUNCATE TABLE sr1_step")
            cur.execute("TRUNCATE TABLE sr1_path")
            cur.execute("TRUNCATE TABLE sr1_root")
            cur.executemany("INSERT INTO sr1_root (domain_id,domain) VALUES (%s,%s)", [(i, f"d{i:02d}.example.test") for i in range(30)])
            conn.commit()
            for start in range(0, n, 100):
                heads, steps = [], []
                for pid in range(start, min(start + 100, n)):
                    path = path_record(pid, distribution)
                    pid = path["path_id"]
                    heads.append((pid, path["domain_id"], path["intent"], 1, path["steps"][0]["step_id"], matrix[pid].tobytes()))
                    for st in path["steps"]:
                        steps.append((st["step_id"], pid, st["ordinal"], st["url"], st["action"], json.dumps(st["selectors"]), st["description"], st["isInput"], None, None, st["shouldWait"], None, json.dumps(st["textLabels"])))
                cur.executemany("INSERT INTO sr1_path (path_id,domain_id,task_intent,weight,first_step_id,intent_embedding) VALUES (%s,%s,%s,%s,%s,%s)", heads)
                cur.executemany("INSERT INTO sr1_step (step_id,path_id,ordinal,url,action,selectors,description,is_input,input_type,input_placeholder,should_wait,wait_message,text_labels) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", steps)
                conn.commit()
            cur.execute("SELECT count(*) FROM sr1_path")
            paths = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM sr1_step")
            step_count = cur.fetchone()[0]
        return {"load_seconds": round(time.perf_counter() - started, 3), "index_build_seconds": 0, "counts": {"paths": paths, "steps": step_count, "edges": step_count - paths}, "index_state": "mysql secondary indexes online"}
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("neo", "mysql"), required=True)
    parser.add_argument("--n", type=int, choices=(1000, 10000, 30000), required=True)
    parser.add_argument("--distribution", choices=("uniform", "skew"), required=True)
    parser.add_argument("--label", required=True, help="Output label; existing output cannot be overwritten")
    args = parser.parse_args()
    validate_inputs()
    LOADS.mkdir(exist_ok=True)
    output = LOADS / f"{args.label}.json"
    if output.exists():
        raise RuntimeError(f"load record already exists: {output}")
    matrix = np.load(ASSETS / f"paths_{args.distribution}.npy", mmap_mode="r")
    result = neo_load(args.n, args.distribution, matrix) if args.backend == "neo" else mysql_load(args.n, args.distribution, matrix)
    expected_edges = sum((5, 10, 20)[i % 3] for i in range(args.n))
    expected_steps = expected_edges + args.n
    if result["counts"] != {"paths": args.n, "steps": expected_steps, "edges": expected_edges}:
        raise RuntimeError(f"loaded counts mismatch: {result['counts']}")
    record = {"backend": args.backend, "n": args.n, "distribution": args.distribution, "input_sha256": checksum(ASSETS / f"paths_{args.distribution}.npy"), **result}
    output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(record, sort_keys=True))


if __name__ == "__main__":
    main()
