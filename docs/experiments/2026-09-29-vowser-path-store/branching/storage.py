"""실험 3 전용 br3_/BR3_ 객체 적재와 네 비교 질의."""

from __future__ import annotations

import time

from neo4j import Query
from shared.connect import mysql_connection, neo4j_driver

from branching.model import FIELDS, Model, digest

MYSQL_DDL = [
    """CREATE TABLE br3_path (
      condition_id VARCHAR(32) NOT NULL, path_id INT NOT NULL,
      domain VARCHAR(64) NOT NULL, intent VARCHAR(32) NOT NULL, auth TINYINT NOT NULL,
      depth TINYINT NOT NULL, original_intent VARCHAR(32) NOT NULL,
      start_step_id CHAR(32) NOT NULL,
      PRIMARY KEY (condition_id,path_id),
      KEY br3_context (condition_id,domain,intent,auth,depth,path_id)
    ) ENGINE=InnoDB""",
    """CREATE TABLE br3_step (
      condition_id VARCHAR(32) NOT NULL, step_id CHAR(32) NOT NULL,
      url VARCHAR(255) NOT NULL, action VARCHAR(32) NOT NULL,
      selector VARCHAR(64) NOT NULL, description VARCHAR(255) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      PRIMARY KEY (condition_id,step_id)
    ) ENGINE=InnoDB""",
    """CREATE TABLE br3_member (
      condition_id VARCHAR(32) NOT NULL, path_id INT NOT NULL,
      ordinal TINYINT NOT NULL, step_id CHAR(32) NOT NULL,
      PRIMARY KEY (condition_id,path_id,ordinal),
      KEY br3_member_path_step (condition_id,path_id,step_id),
      KEY br3_member_step (condition_id,step_id,path_id)
    ) ENGINE=InnoDB""",
    """CREATE TABLE br3_next (
      condition_id VARCHAR(32) NOT NULL, path_id INT NOT NULL,
      ordinal TINYINT NOT NULL, from_step_id CHAR(32) NOT NULL,
      to_step_id CHAR(32) NOT NULL,
      PRIMARY KEY (condition_id,path_id,ordinal),
      KEY br3_next_from (condition_id,from_step_id,path_id,ordinal)
    ) ENGINE=InnoDB""",
]

NEO_CONSTRAINTS = [
    "CREATE CONSTRAINT br3_path_unique IF NOT EXISTS FOR (p:BR3_Path) REQUIRE (p.condition,p.pathId) IS UNIQUE",
    "CREATE CONSTRAINT br3_step_unique IF NOT EXISTS FOR (s:BR3_Step) REQUIRE (s.condition,s.stepId) IS UNIQUE",
    "CREATE INDEX br3_path_context IF NOT EXISTS FOR (p:BR3_Path) ON (p.condition,p.domain,p.intent,p.auth)",
]

SQL_ELIGIBLE = """SELECT p.path_id,p.domain,p.intent,p.auth,p.depth,p.start_step_id
FROM br3_path p
WHERE p.condition_id=%s AND p.domain=%s AND p.intent=%s AND p.auth=%s
AND NOT EXISTS (
 SELECT 1 FROM br3_member x
 WHERE x.condition_id=p.condition_id AND x.path_id=p.path_id
 AND x.step_id IN ({blocked})
)
ORDER BY p.depth,p.path_id LIMIT 3"""

SQL_MEMBERSHIP = """WITH eligible AS ({eligible})
SELECT e.path_id,e.domain,e.intent,e.auth,e.depth,m.ordinal,
 s.step_id,s.url,s.action,s.selector,s.description
FROM eligible e JOIN br3_member m ON m.condition_id=%s AND m.path_id=e.path_id
JOIN br3_step s ON s.condition_id=m.condition_id AND s.step_id=m.step_id
ORDER BY e.depth,e.path_id,m.ordinal"""

SQL_ADJACENCY = """WITH RECURSIVE roots AS (
 SELECT p.path_id,p.domain,p.intent,p.auth,p.depth,p.start_step_id
 FROM br3_path p
 WHERE p.condition_id=%s AND p.domain=%s AND p.intent=%s AND p.auth=%s
),
walk AS (
 SELECT r.path_id,0 AS ordinal,r.start_step_id AS step_id
 FROM roots r WHERE r.start_step_id NOT IN ({blocked})
 UNION ALL
 SELECT w.path_id,w.ordinal+1,n.to_step_id
 FROM walk w JOIN br3_next n ON n.condition_id=%s AND n.path_id=w.path_id
  AND n.ordinal=w.ordinal AND n.from_step_id=w.step_id
 WHERE w.ordinal<%s AND n.to_step_id NOT IN ({blocked})
),
winners AS (
 SELECT r.path_id,r.domain,r.intent,r.auth,r.depth
 FROM roots r JOIN walk w ON w.path_id=r.path_id AND w.ordinal=r.depth
 ORDER BY r.depth,r.path_id LIMIT 3
)
SELECT e.path_id,e.domain,e.intent,e.auth,e.depth,w.ordinal,
 s.step_id,s.url,s.action,s.selector,s.description
FROM winners e JOIN walk w ON w.path_id=e.path_id
JOIN br3_step s ON s.condition_id=%s AND s.step_id=w.step_id
ORDER BY e.depth,e.path_id,w.ordinal"""

NEO_ELIGIBLE = """MATCH (p:BR3_Path {condition:$cell,domain:$domain,intent:$intent,auth:$auth})
WHERE NOT EXISTS {
 MATCH (p)-[:BR3_MEMBER]->(b:BR3_Step)
 WHERE b.stepId IN $blocked
}
WITH p ORDER BY p.depth,p.pathId LIMIT 3"""

NEO_MEMBERSHIP = NEO_ELIGIBLE + """
MATCH (p)-[m:BR3_MEMBER]->(s:BR3_Step)
RETURN p.pathId AS path_id,p.domain AS domain,p.intent AS intent,p.auth AS auth,
 p.depth AS depth,m.ordinal AS ordinal,s.stepId AS step_id,s.url AS url,
 s.action AS action,s.selector AS selector,s.description AS description
ORDER BY depth,path_id,ordinal"""

NEO_ADJACENCY = """MATCH (p:BR3_Path {condition:$cell,domain:$domain,intent:$intent,auth:$auth})
MATCH (p)-[:BR3_MEMBER {ordinal:0}]->(start:BR3_Step)
WHERE NOT start.stepId IN $blocked
MATCH route = (start)-[r:BR3_NEXT WHERE r.condition=$cell AND r.pathId=p.pathId
 AND NOT r.toStepId IN $blocked]->{5,20}(finish)
WHERE length(route)=p.depth AND
 ALL(i IN range(0,p.depth-1) WHERE relationships(route)[i].ordinal=i)
WITH p,route ORDER BY p.depth,p.pathId LIMIT 3
UNWIND range(0,size(nodes(route))-1) AS ord
WITH p,ord,nodes(route)[ord] AS s
RETURN p.pathId AS path_id,p.domain AS domain,p.intent AS intent,p.auth AS auth,
 p.depth AS depth,ord AS ordinal,s.stepId AS step_id,s.url AS url,
 s.action AS action,s.selector AS selector,s.description AS description
ORDER BY depth,path_id,ordinal"""


def batches(items, size=500):
    items = list(items)
    for offset in range(0, len(items), size):
        yield items[offset:offset + size]


def load_mysql(model: Model) -> dict:
    start = time.monotonic()
    con = mysql_connection()
    try:
        with con.cursor() as cur:
            for table in ("br3_next", "br3_member", "br3_step", "br3_path"):
                cur.execute(f"DROP TABLE IF EXISTS {table}")
            for ddl in MYSQL_DDL:
                cur.execute(ddl)
            for rows in batches([
                (model.cell,p["path_id"],p["domain"],p["intent"],p["auth"],
                 p["depth"],p["original_intent"],p["start_step_id"])
                for p in model.paths.values()
            ], 1000):
                cur.executemany("INSERT INTO br3_path VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", rows)
            for rows in batches([
                (model.cell,s["step_id"],s["url"],s["action"],s["selector"],s["description"],s["kind"])
                for s in model.steps.values()
            ], 1000):
                cur.executemany("INSERT INTO br3_step VALUES (%s,%s,%s,%s,%s,%s,%s)", rows)
            for rows in batches([(model.cell,*m) for m in model.members], 1000):
                cur.executemany("INSERT INTO br3_member VALUES (%s,%s,%s,%s)", rows)
            for rows in batches([(model.cell,*e) for e in model.next_edges], 1000):
                cur.executemany("INSERT INTO br3_next VALUES (%s,%s,%s,%s,%s)", rows)
        con.commit()
        with con.cursor() as cur:
            counts = {}
            for table in ("br3_path", "br3_step", "br3_member", "br3_next"):
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                counts[table] = cur.fetchone()[0]
            cur.execute("""SELECT table_name,data_length,index_length
                FROM information_schema.tables
                WHERE table_schema='vowser_eval_v2' AND table_name LIKE 'br3_%'""")
            table_bytes = {name:{"data_length":data,"index_length":index}
                           for name,data,index in cur.fetchall()}
        return {"load_seconds": time.monotonic()-start, "counts": counts,
                "mysql_estimated_table_bytes":table_bytes}
    finally:
        con.close()


def neo_delete_label(session, label: str) -> None:
    while True:
        record = session.run(
            f"MATCH (n:{label}) WITH n LIMIT 5000 DETACH DELETE n RETURN count(n) AS deleted"
        ).single()
        if not record or not record["deleted"]:
            return


def load_neo(model: Model) -> dict:
    start = time.monotonic()
    driver = neo4j_driver()
    try:
        with driver.session(database="neo4j") as session:
            neo_delete_label(session, "BR3_Path")
            neo_delete_label(session, "BR3_Step")
            session.run("DROP INDEX br3_path_context IF EXISTS").consume()
            for ddl in NEO_CONSTRAINTS:
                session.run(ddl).consume()
            session.run("CALL db.awaitIndexes(300)").consume()
            for batch in batches([{"condition":model.cell,"pathId":p["path_id"],
                                   "domain":p["domain"],"intent":p["intent"],
                                   "auth":p["auth"],"depth":p["depth"],
                                   "originalIntent":p["original_intent"]}
                                  for p in model.paths.values()]):
                session.run("UNWIND $rows AS row CREATE (p:BR3_Path) SET p=row", rows=batch).consume()
            for batch in batches([{"condition":model.cell,"stepId":s["step_id"],
                                   "url":s["url"],"action":s["action"],
                                   "selector":s["selector"],"description":s["description"],
                                   "kind":s["kind"]} for s in model.steps.values()]):
                session.run("UNWIND $rows AS row CREATE (s:BR3_Step) SET s=row", rows=batch).consume()
            for batch in batches([{"pathId":p,"ordinal":o,"stepId":s} for p,o,s in model.members]):
                session.run("""UNWIND $rows AS row
                MATCH (p:BR3_Path {condition:$cell,pathId:row.pathId})
                MATCH (s:BR3_Step {condition:$cell,stepId:row.stepId})
                CREATE (p)-[:BR3_MEMBER {condition:$cell,ordinal:row.ordinal}]->(s)""",
                rows=batch,cell=model.cell).consume()
            for batch in batches([{"pathId":p,"ordinal":o,"fromId":a,"toId":b}
                                  for p,o,a,b in model.next_edges]):
                session.run("""UNWIND $rows AS row
                MATCH (a:BR3_Step {condition:$cell,stepId:row.fromId})
                MATCH (b:BR3_Step {condition:$cell,stepId:row.toId})
                CREATE (a)-[:BR3_NEXT {condition:$cell,pathId:row.pathId,
                ordinal:row.ordinal,toStepId:row.toId}]->(b)""",
                rows=batch,cell=model.cell).consume()
            counts = session.run("""MATCH (p:BR3_Path) WITH count(p) AS paths
            MATCH (s:BR3_Step) WITH paths,count(s) AS steps
            MATCH ()-[m:BR3_MEMBER]->() WITH paths,steps,count(m) AS members
            MATCH ()-[n:BR3_NEXT]->() RETURN paths,steps,members,count(n) AS next_edges""").single().data()
        return {"load_seconds": time.monotonic()-start, "counts": counts}
    finally:
        driver.close()


def mysql_query(con, mode: str, cell: str, case: dict, depth_limit: int = 20) -> list[dict]:
    sql, params = mysql_statement(mode, cell, case, depth_limit)
    with con.cursor() as cur:
        cur.execute(sql,params)
        raw = cur.fetchall()
    return [dict(zip(FIELDS,row)) for row in raw]


def mysql_statement(mode: str, cell: str, case: dict, depth_limit: int = 20):
    blocked = case["blocked"]
    placeholders = ",".join(["%s"]*len(blocked))
    if mode == "mysql_member":
        eligible = SQL_ELIGIBLE.format(blocked=placeholders)
        sql = SQL_MEMBERSHIP.format(eligible=eligible)
        params = (cell,case["domain"],case["intent"],case["auth"],*blocked,cell)
    elif mode == "mysql_adj":
        sql = SQL_ADJACENCY.format(blocked=placeholders)
        params = (cell,case["domain"],case["intent"],case["auth"],
                  *blocked,cell,depth_limit,*blocked,cell)
    else:
        raise ValueError(mode)
    return sql, params


def neo_query(session, mode: str, cell: str, case: dict, depth_limit: int = 20) -> list[dict]:
    query = NEO_MEMBERSHIP if mode == "neo_member" else NEO_ADJACENCY
    if mode not in ("neo_member", "neo_adj"):
        raise ValueError(mode)
    if mode == "neo_adj":
        query = query.replace("{5,20}",f"{{5,{depth_limit}}}")
    result = session.run(Query(query, timeout=2.0), cell=cell,
                         domain=case["domain"],intent=case["intent"],
                         auth=case["auth"],blocked=case["blocked"])
    return [{field:record[field] for field in FIELDS} for record in result]


def verify_full_membership(model: Model) -> dict:
    """모든 소속과 canonical STEP payload를 두 DB에서 독립 원장과 대조."""
    con = mysql_connection()
    driver = neo4j_driver()
    verified = {"mysql": 0, "neo4j": 0, "ranges": []}
    try:
        with driver.session(database="neo4j") as session:
            for lo in range(0, model.total, 500):
                hi = min(lo+500, model.total)
                expected = model.rows_for(list(range(lo,hi)))
                expected_hash = digest(expected)
                with con.cursor() as cur:
                    cur.execute("""SELECT p.path_id,p.domain,p.intent,p.auth,p.depth,m.ordinal,
                    s.step_id,s.url,s.action,s.selector,s.description
                    FROM br3_path p JOIN br3_member m
                    ON m.condition_id=p.condition_id AND m.path_id=p.path_id
                    JOIN br3_step s ON s.condition_id=m.condition_id AND s.step_id=m.step_id
                    WHERE p.condition_id=%s AND p.path_id>=%s AND p.path_id<%s
                    ORDER BY p.path_id,m.ordinal""",(model.cell,lo,hi))
                    mysql_rows = [dict(zip(FIELDS,row)) for row in cur.fetchall()]
                neo_rows = [{field:record[field] for field in FIELDS} for record in session.run("""
                    MATCH (p:BR3_Path {condition:$cell})-[m:BR3_MEMBER]->(s:BR3_Step)
                    WHERE p.pathId >= $lo AND p.pathId < $hi
                    RETURN p.pathId AS path_id,p.domain AS domain,p.intent AS intent,p.auth AS auth,
                    p.depth AS depth,m.ordinal AS ordinal,s.stepId AS step_id,s.url AS url,
                    s.action AS action,s.selector AS selector,s.description AS description
                    ORDER BY path_id,ordinal""",cell=model.cell,lo=lo,hi=hi)]
                hashes = {"expected":expected_hash,"mysql":digest(mysql_rows),"neo4j":digest(neo_rows)}
                if len(set(hashes.values())) != 1:
                    raise AssertionError(f"membership/payload mismatch {lo}:{hi}: {hashes}")
                verified["mysql"] += len(mysql_rows)
                verified["neo4j"] += len(neo_rows)
                verified["ranges"].append({"lo":lo,"hi":hi,"rows":len(expected),"sha256":expected_hash})
        return verified
    finally:
        con.close()
        driver.close()


def verify_engine_membership(model: Model, engine: str) -> dict:
    """단일 DB 활성 조건에서 전 경로 소속·payload를 생성 원장에 대조."""
    if engine not in ('mysql','neo4j'):
        raise ValueError(engine)
    con = mysql_connection() if engine == 'mysql' else None
    driver = neo4j_driver() if engine == 'neo4j' else None
    verified = {'engine':engine,'rows':0,'ranges':[]}
    try:
        session = driver.session(database='neo4j') if driver else None
        try:
            for lo in range(0,model.total,500):
                hi = min(lo+500,model.total)
                expected = model.rows_for(list(range(lo,hi)))
                expected_hash = digest(expected)
                if engine == 'mysql':
                    with con.cursor() as cur:
                        cur.execute("""SELECT p.path_id,p.domain,p.intent,p.auth,p.depth,m.ordinal,
                        s.step_id,s.url,s.action,s.selector,s.description
                        FROM br3_path p JOIN br3_member m
                        ON m.condition_id=p.condition_id AND m.path_id=p.path_id
                        JOIN br3_step s ON s.condition_id=m.condition_id AND s.step_id=m.step_id
                        WHERE p.condition_id=%s AND p.path_id>=%s AND p.path_id<%s
                        ORDER BY p.path_id,m.ordinal""",(model.cell,lo,hi))
                        rows = [dict(zip(FIELDS,row)) for row in cur.fetchall()]
                else:
                    rows = [{field:record[field] for field in FIELDS} for record in session.run("""
                        MATCH (p:BR3_Path {condition:$cell})-[m:BR3_MEMBER]->(s:BR3_Step)
                        WHERE p.pathId >= $lo AND p.pathId < $hi
                        RETURN p.pathId AS path_id,p.domain AS domain,p.intent AS intent,p.auth AS auth,
                        p.depth AS depth,m.ordinal AS ordinal,s.stepId AS step_id,s.url AS url,
                        s.action AS action,s.selector AS selector,s.description AS description
                        ORDER BY path_id,ordinal""",cell=model.cell,lo=lo,hi=hi)]
                actual_hash = digest(rows)
                if expected_hash != actual_hash:
                    raise AssertionError(f'{engine} membership/payload mismatch {lo}:{hi}: {expected_hash} != {actual_hash}')
                verified['rows'] += len(rows)
                verified['ranges'].append({'lo':lo,'hi':hi,'rows':len(rows),'sha256':actual_hash})
        finally:
            if session:
                session.close()
        return verified
    finally:
        if con:
            con.close()
        if driver:
            driver.close()


def cleanup_own_objects() -> None:
    """다른 실험의 객체를 건드리지 않고 BR3/br3 전용 객체만 제거."""
    cleanup_engine('mysql')
    cleanup_engine('neo4j')


def cleanup_engine(engine: str) -> None:
    """하나의 활성 DB만 사용할 때 해당 엔진의 BR3/br3만 제거."""
    if engine == 'mysql':
        con = mysql_connection()
        try:
            with con.cursor() as cur:
                for table in ("br3_next","br3_member","br3_step","br3_path"):
                    cur.execute(f"DROP TABLE IF EXISTS {table}")
            con.commit()
        finally:
            con.close()
        return
    if engine != 'neo4j':
        raise ValueError(engine)
    driver = neo4j_driver()
    try:
        with driver.session(database="neo4j") as session:
            neo_delete_label(session,"BR3_Path")
            neo_delete_label(session,"BR3_Step")
            session.run("DROP INDEX br3_path_context IF EXISTS").consume()
            session.run("DROP CONSTRAINT br3_path_unique IF EXISTS").consume()
            session.run("DROP CONSTRAINT br3_step_unique IF EXISTS").consume()
    finally:
        driver.close()
