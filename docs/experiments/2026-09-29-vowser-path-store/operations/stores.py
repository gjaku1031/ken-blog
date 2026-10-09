"""실험 2의 두 DB에 동일 운영 상태를 저장·조회하는 직접 구현.

원본 FastAPI/임베딩 함수 전체를 호출하지 않는다. Neo4j 원본형 관계·조회 의미를
재현하되 주 비교군의 등록·갱신은 각 DB에 유리한 배치·트랜잭션을 사용한다.
"""

from __future__ import annotations

import json
from collections import Counter

import pymysql

from shared.connect import mysql_connection, neo4j_driver
from shared.data import domain_id, iter_paths, path_record


def step_rows(record):
    return [{
        "stepId": s["step_id"], "pathId": record["path_id"],
        "ordinal": s["ordinal"], "url": s["url"], "domain": s["domain"],
        "selectors": s["selectors"], "action": s["action"],
        "description": s["description"], "isInput": s["isInput"],
        "shouldWait": s["shouldWait"], "textLabels": s["textLabels"],
        "successRate": s["successRate"], "usageCount": 1,
    } for s in record["steps"]]


def root_counts(initial, distribution):
    counts = Counter(domain_id(i, distribution) for i in range(initial))
    return [{"domain": f"d{did:02d}.example.test", "visitCount": count - 1}
            for did, count in sorted(counts.items())]


class MySQLStore:
    name = "mysql"

    def __init__(self):
        self.conn = mysql_connection()

    def close(self):
        self.conn.close()

    def initialize(self):
        ddl = [
            """CREATE TABLE op2_root (
              domain VARCHAR(64) PRIMARY KEY,
              base_url VARCHAR(160) NOT NULL,
              visit_count INT NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
            """CREATE TABLE op2_has_step (
              path_id INT PRIMARY KEY,
              domain VARCHAR(64) NOT NULL,
              first_step_id CHAR(32) NOT NULL,
              task_intent VARCHAR(64) NOT NULL,
              depth TINYINT UNSIGNED NOT NULL,
              weight INT NOT NULL,
              INDEX domain_weight_path (domain, weight DESC, path_id),
              FOREIGN KEY (domain) REFERENCES op2_root(domain)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
            """CREATE TABLE op2_step (
              step_id CHAR(32) PRIMARY KEY,
              path_id INT NOT NULL,
              ordinal TINYINT UNSIGNED NOT NULL,
              url VARCHAR(255) NOT NULL,
              domain VARCHAR(64) NOT NULL,
              selectors JSON NOT NULL,
              action VARCHAR(24) NOT NULL,
              description VARCHAR(255) NOT NULL,
              is_input BOOLEAN NOT NULL,
              should_wait BOOLEAN NOT NULL,
              text_labels JSON NOT NULL,
              success_rate DOUBLE NOT NULL,
              usage_count INT NOT NULL,
              UNIQUE KEY path_ordinal (path_id, ordinal),
              INDEX domain_action (domain, action),
              FOREIGN KEY (path_id) REFERENCES op2_has_step(path_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
            """CREATE TABLE op2_next_step (
              path_id INT NOT NULL,
              ordinal TINYINT UNSIGNED NOT NULL,
              from_step_id CHAR(32) NOT NULL,
              to_step_id CHAR(32) NOT NULL,
              weight INT NOT NULL,
              PRIMARY KEY (path_id, ordinal),
              INDEX next_from (from_step_id),
              INDEX next_to (to_step_id),
              FOREIGN KEY (path_id) REFERENCES op2_has_step(path_id),
              FOREIGN KEY (from_step_id) REFERENCES op2_step(step_id),
              FOREIGN KEY (to_step_id) REFERENCES op2_step(step_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
            """CREATE PROCEDURE op2_increment_path(IN p_path_id INT)
            BEGIN
              UPDATE op2_root AS r JOIN op2_has_step AS h ON h.domain = r.domain
                SET r.visit_count = r.visit_count + 1 WHERE h.path_id = p_path_id;
              UPDATE op2_has_step SET weight = weight + 1 WHERE path_id = p_path_id;
              UPDATE op2_step SET usage_count = usage_count + 1 WHERE path_id = p_path_id;
              UPDATE op2_next_step SET weight = weight + 1 WHERE path_id = p_path_id;
            END""",
        ]
        with self.conn.cursor() as cur:
            cur.execute("DROP PROCEDURE IF EXISTS op2_increment_path")
            for table in ("op2_next_step", "op2_step", "op2_has_step", "op2_root"):
                cur.execute(f"DROP TABLE IF EXISTS {table}")
            for statement in ddl:
                cur.execute(statement)
        self.conn.commit()

    def seed(self, initial, distribution):
        roots = root_counts(initial, distribution)
        with self.conn.cursor() as cur:
            cur.executemany("INSERT INTO op2_root VALUES (%s,%s,%s)",
                            [(r["domain"], f"https://{r['domain']}", r["visitCount"]) for r in roots])
        self.conn.commit()
        for begin in range(0, initial, 50):
            paths = [path_record(i, distribution) for i in range(begin, min(begin + 50, initial))]
            has, steps, edges = [], [], []
            for record in paths:
                has.append((record["path_id"], record["domain"],
                            record["steps"][0]["step_id"], record["intent"], record["depth"], 1))
                for s in record["steps"]:
                    steps.append((s["step_id"], record["path_id"], s["ordinal"], s["url"],
                                  s["domain"], json.dumps(s["selectors"]), s["action"],
                                  s["description"], s["isInput"], s["shouldWait"],
                                  json.dumps(s["textLabels"]), s["successRate"], 1))
                for ordinal in range(1, len(record["steps"])):
                    edges.append((record["path_id"], ordinal,
                                  record["steps"][ordinal - 1]["step_id"],
                                  record["steps"][ordinal]["step_id"], 1))
            try:
                with self.conn.cursor() as cur:
                    cur.executemany("INSERT INTO op2_has_step VALUES (%s,%s,%s,%s,%s,%s)", has)
                    cur.executemany("""INSERT INTO op2_step
                      VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", steps)
                    cur.executemany("INSERT INTO op2_next_step VALUES (%s,%s,%s,%s,%s)", edges)
                self.conn.commit()
            except Exception:
                self.conn.rollback()
                raise
            if begin % 1000 == 0:
                print(f"mysql seed {min(begin + 50, initial)}/{initial}", flush=True)

    def register(self, record):
        path_id = record["path_id"]
        try:
            with self.conn.cursor() as cur:
                cur.execute("UPDATE op2_root SET visit_count=visit_count+1 WHERE domain=%s",
                            (record["domain"],))
                cur.execute("INSERT INTO op2_has_step VALUES (%s,%s,%s,%s,%s,1)",
                            (path_id, record["domain"], record["steps"][0]["step_id"],
                             record["intent"], record["depth"]))
                cur.executemany("""INSERT INTO op2_step VALUES
                  (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1)""",
                    [(s["step_id"], path_id, s["ordinal"], s["url"], s["domain"],
                      json.dumps(s["selectors"]), s["action"], s["description"],
                      s["isInput"], s["shouldWait"], json.dumps(s["textLabels"]),
                      s["successRate"]) for s in record["steps"]])
                cur.executemany("INSERT INTO op2_next_step VALUES (%s,%s,%s,%s,1)",
                    [(path_id, ordinal, record["steps"][ordinal - 1]["step_id"],
                      record["steps"][ordinal]["step_id"])
                     for ordinal in range(1, len(record["steps"]))])
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def update(self, path_id):
        try:
            with self.conn.cursor() as cur:
                cur.execute("CALL op2_increment_path(%s)", (path_id,))
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def popular(self, domain):
        with self.conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("""SELECT h.path_id, h.domain, h.task_intent,
              h.weight, s.description
              FROM op2_has_step h JOIN op2_step s ON s.step_id=h.first_step_id
              WHERE h.domain=%s ORDER BY h.weight DESC,h.path_id ASC LIMIT 10""", (domain,))
            rows = cur.fetchall()
        return [{"path_id": row["path_id"], "domain": row["domain"],
                 "taskIntent": row["task_intent"], "usageCount": row["weight"],
                 "firstStepDescription": row["description"]} for row in rows]

    def visualize(self, domain):
        with self.conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("""SELECT path_id,task_intent,weight,depth FROM op2_has_step
              WHERE domain=%s ORDER BY weight DESC,path_id ASC LIMIT 10""", (domain,))
            rows = cur.fetchall()
            valid_ids = [row["path_id"] for row in rows if row["depth"] <= 10]
            descriptions = {path_id: [] for path_id in valid_ids}
            if valid_ids:
                marks = ",".join(["%s"] * len(valid_ids))
                cur.execute(f"""SELECT path_id,description FROM op2_step
                  WHERE path_id IN ({marks}) ORDER BY path_id,ordinal""", valid_ids)
                for row in cur.fetchall():
                    descriptions[row["path_id"]].append(row["description"])
        return [{"path_id": row["path_id"], "taskIntent": row["task_intent"],
                 "weight": row["weight"],
                 "steps": descriptions[row["path_id"]] if row["depth"] <= 10 else None,
                 "pathLength": row["depth"] if row["depth"] <= 10 else None}
                for row in rows]

    def reset(self, new_ids, updated_ids, roots):
        try:
            with self.conn.cursor() as cur:
                marks = ",".join(["%s"] * len(new_ids))
                cur.execute(f"DELETE FROM op2_next_step WHERE path_id IN ({marks})", new_ids)
                cur.execute(f"DELETE FROM op2_step WHERE path_id IN ({marks})", new_ids)
                cur.execute(f"DELETE FROM op2_has_step WHERE path_id IN ({marks})", new_ids)
                if updated_ids:
                    marks = ",".join(["%s"] * len(updated_ids))
                    cur.execute(f"UPDATE op2_has_step SET weight=1 WHERE path_id IN ({marks})", updated_ids)
                    cur.execute(f"UPDATE op2_step SET usage_count=1 WHERE path_id IN ({marks})", updated_ids)
                    cur.execute(f"UPDATE op2_next_step SET weight=1 WHERE path_id IN ({marks})", updated_ids)
                cur.executemany("UPDATE op2_root SET visit_count=%s WHERE domain=%s",
                                [(r["visitCount"], r["domain"]) for r in roots])
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def counts(self):
        with self.conn.cursor() as cur:
            result = {}
            for key, table in (("roots", "op2_root"), ("paths", "op2_has_step"),
                               ("steps", "op2_step"), ("edges", "op2_next_step")):
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                result[key] = cur.fetchone()[0]
        return result

    def weights(self):
        with self.conn.cursor() as cur:
            cur.execute("SELECT path_id,weight FROM op2_has_step ORDER BY path_id")
            return cur.fetchall()

    def root_visits(self):
        with self.conn.cursor() as cur:
            cur.execute("SELECT domain,visit_count FROM op2_root ORDER BY domain")
            return dict(cur.fetchall())

    def touched_state(self, path_ids):
        ids = sorted(path_ids)
        if not ids:
            return {}
        marks = ",".join(["%s"] * len(ids))
        with self.conn.cursor() as cur:
            cur.execute(f"SELECT path_id,weight FROM op2_has_step WHERE path_id IN ({marks}) ORDER BY path_id", ids)
            has = dict(cur.fetchall())
            cur.execute(f"SELECT path_id,MIN(usage_count),MAX(usage_count),COUNT(*) FROM op2_step WHERE path_id IN ({marks}) GROUP BY path_id", ids)
            steps = {r[0]: (r[1], r[2], r[3]) for r in cur.fetchall()}
            cur.execute(f"SELECT path_id,MIN(weight),MAX(weight),COUNT(*) FROM op2_next_step WHERE path_id IN ({marks}) GROUP BY path_id", ids)
            edges = {r[0]: (r[1], r[2], r[3]) for r in cur.fetchall()}
        return {str(i): {"has_weight": has.get(i), "step": steps.get(i), "edge": edges.get(i)} for i in ids}

    def iter_rows(self, kind):
        """전체 payload 정합용 서버 스트리밍 결과. 측정 구간 밖에서만 사용."""
        queries = {
            "root": "SELECT domain,base_url AS baseURL,visit_count AS visitCount FROM op2_root ORDER BY domain",
            "has": """SELECT path_id AS pathId,domain,first_step_id AS firstStepId,
              task_intent AS taskIntent,weight FROM op2_has_step ORDER BY path_id""",
            "step": """SELECT step_id AS stepId,path_id AS pathId,ordinal,url,domain,
              selectors,action,description,is_input AS isInput,should_wait AS shouldWait,
              text_labels AS textLabels,success_rate AS successRate,usage_count AS usageCount
              FROM op2_step ORDER BY path_id,ordinal""",
            "edge": """SELECT path_id AS pathId,ordinal AS sequenceOrder,
              from_step_id AS fromId,to_step_id AS toId,weight
              FROM op2_next_step ORDER BY path_id,ordinal""",
        }
        with self.conn.cursor(pymysql.cursors.SSDictCursor) as cur:
            cur.execute(queries[kind])
            for row in cur:
                item = dict(row)
                if kind == "step":
                    item["selectors"] = json.loads(item["selectors"])
                    item["textLabels"] = json.loads(item["textLabels"])
                    item["isInput"] = bool(item["isInput"])
                    item["shouldWait"] = bool(item["shouldWait"])
                yield item


class Neo4jStore:
    name = "neo4j"

    def __init__(self):
        self.driver = neo4j_driver()

    def close(self):
        self.driver.close()

    def _query(self, cypher, **parameters):
        with self.driver.session(database="neo4j") as session:
            return list(session.run(cypher, **parameters))

    def initialize(self):
        with self.driver.session(database="neo4j") as session:
            # 30k 경로는 수십만 STEP이므로 준비 구간에서도 단일 대형
            # 트랜잭션을 피한다. OP2 라벨에만 한정해 타 실험은 보존한다.
            while True:
                deleted = session.run("""MATCH (s:OP2_STEP) WITH s LIMIT 1000
                  DETACH DELETE s RETURN count(*) AS n""").single()["n"]
                if deleted == 0:
                    break
            session.run("MATCH (r:OP2_ROOT) DETACH DELETE r").consume()
            for statement in (
                "CREATE CONSTRAINT op2_root_domain IF NOT EXISTS FOR (r:OP2_ROOT) REQUIRE r.domain IS UNIQUE",
                "CREATE CONSTRAINT op2_step_id IF NOT EXISTS FOR (s:OP2_STEP) REQUIRE s.stepId IS UNIQUE",
                "CREATE INDEX op2_step_path IF NOT EXISTS FOR (s:OP2_STEP) ON (s.pathId,s.ordinal)",
                "CREATE INDEX op2_has_path IF NOT EXISTS FOR ()-[h:OP2_HAS_STEP]-() ON (h.pathId)",
                "CREATE INDEX op2_next_path IF NOT EXISTS FOR ()-[e:OP2_NEXT_STEP]-() ON (e.pathId)",
            ):
                session.run(statement).consume()
            session.run("CALL db.awaitIndexes(300)").consume()

    def seed(self, initial, distribution):
        roots = root_counts(initial, distribution)
        self._query("""UNWIND $roots AS row
          CREATE (r:OP2_ROOT {domain:row.domain, baseURL:'https://' + row.domain,
            visitCount:row.visitCount})""", roots=roots)
        for begin in range(0, initial, 50):
            paths = [path_record(i, distribution) for i in range(begin, min(begin + 50, initial))]
            steps = [s for record in paths for s in step_rows(record)]
            has = [{"pathId": record["path_id"], "domain": record["domain"],
                    "firstId": record["steps"][0]["step_id"],
                    "taskIntent": record["intent"]} for record in paths]
            edges = [{"pathId": record["path_id"], "sequenceOrder": ordinal,
                      "fromId": record["steps"][ordinal - 1]["step_id"],
                      "toId": record["steps"][ordinal]["step_id"]}
                     for record in paths for ordinal in range(1, len(record["steps"]))]
            def write_batch(tx):
                tx.run("UNWIND $rows AS row CREATE (s:OP2_STEP) SET s = row", rows=steps).consume()
                tx.run("""UNWIND $rows AS row
                  MATCH (r:OP2_ROOT {domain:row.domain})
                  MATCH (s:OP2_STEP {stepId:row.firstId})
                  CREATE (r)-[:OP2_HAS_STEP {pathId:row.pathId,
                    taskIntent:row.taskIntent, weight:1}]->(s)""", rows=has).consume()
                tx.run("""UNWIND $rows AS row
                  MATCH (a:OP2_STEP {stepId:row.fromId})
                  MATCH (b:OP2_STEP {stepId:row.toId})
                  CREATE (a)-[:OP2_NEXT_STEP {pathId:row.pathId,
                    sequenceOrder:row.sequenceOrder, weight:1}]->(b)""", rows=edges).consume()
            with self.driver.session(database="neo4j") as session:
                session.execute_write(write_batch)
            if begin % 1000 == 0:
                print(f"neo4j seed {min(begin + 50, initial)}/{initial}", flush=True)

    def register(self, record):
        cypher = """
        MATCH (r:OP2_ROOT {domain:$domain})
        SET r.visitCount = r.visitCount + 1
        WITH r
        UNWIND $steps AS row
        CREATE (s:OP2_STEP) SET s = row
        WITH r,s ORDER BY s.ordinal
        WITH r, collect(s) AS nodes
        WITH r,nodes,nodes[0] AS first
        CREATE (r)-[:OP2_HAS_STEP {pathId:$path_id,
          taskIntent:$intent,weight:1}]->(first)
        WITH nodes
        UNWIND range(0,size(nodes)-2) AS i
        WITH nodes[i] AS a, nodes[i+1] AS b, i
        CREATE (a)-[:OP2_NEXT_STEP {pathId:$path_id,
          sequenceOrder:i+1,weight:1}]->(b)
        RETURN count(*) AS edges
        """
        self._query(cypher, domain=record["domain"], path_id=record["path_id"],
                    intent=record["intent"], steps=step_rows(record))

    def update(self, path_id):
        cypher = """
        MATCH (r:OP2_ROOT)-[h:OP2_HAS_STEP {pathId:$path_id}]->(first:OP2_STEP)
        MATCH p=(first)-[:OP2_NEXT_STEP*0..20]->(end:OP2_STEP)
        WHERE NOT (end)-[:OP2_NEXT_STEP]->()
        SET r.visitCount=r.visitCount+1, h.weight=h.weight+1
        FOREACH (s IN nodes(p) | SET s.usageCount=s.usageCount+1)
        FOREACH (e IN relationships(p) | SET e.weight=e.weight+1)
        RETURN length(p) AS depth
        """
        result = self._query(cypher, path_id=path_id)
        if len(result) != 1:
            raise AssertionError(f"Neo4j update expected 1 path for {path_id}, got {len(result)}")

    def popular(self, domain):
        rows = self._query("""MATCH (r:OP2_ROOT {domain:$domain})
          -[h:OP2_HAS_STEP]->(first:OP2_STEP)
          RETURN h.pathId AS path_id,r.domain AS domain,h.taskIntent AS taskIntent,
            h.weight AS usageCount,first.description AS firstStepDescription
          ORDER BY h.weight DESC,h.pathId ASC LIMIT 10""", domain=domain)
        return [dict(row) for row in rows]

    def visualize(self, domain):
        rows = self._query("""MATCH (r:OP2_ROOT {domain:$domain})
          -[h:OP2_HAS_STEP]->(first:OP2_STEP)
          WITH h,first ORDER BY h.weight DESC,h.pathId ASC LIMIT 10
          OPTIONAL MATCH p=(first)-[:OP2_NEXT_STEP*0..10]->(last:OP2_STEP)
          WHERE NOT (last)-[:OP2_NEXT_STEP]->()
          RETURN h.pathId AS path_id,h.taskIntent AS taskIntent,h.weight AS weight,
            CASE WHEN p IS NULL THEN null ELSE [s IN nodes(p) | s.description] END AS steps,
            CASE WHEN p IS NULL THEN null ELSE length(p) END AS pathLength
          ORDER BY weight DESC,path_id ASC""", domain=domain)
        return [dict(row) for row in rows]

    def reset(self, new_ids, updated_ids, roots):
        def reset_tx(tx):
            tx.run("MATCH (s:OP2_STEP) WHERE s.pathId IN $ids DETACH DELETE s",
                   ids=new_ids).consume()
            if updated_ids:
                tx.run("MATCH (s:OP2_STEP) WHERE s.pathId IN $ids SET s.usageCount=1",
                       ids=updated_ids).consume()
                tx.run("MATCH ()-[h:OP2_HAS_STEP]->() WHERE h.pathId IN $ids SET h.weight=1",
                       ids=updated_ids).consume()
                tx.run("MATCH ()-[e:OP2_NEXT_STEP]->() WHERE e.pathId IN $ids SET e.weight=1",
                       ids=updated_ids).consume()
            tx.run("""UNWIND $rows AS row MATCH (r:OP2_ROOT {domain:row.domain})
              SET r.visitCount=row.visitCount""", rows=roots).consume()
        with self.driver.session(database="neo4j") as session:
            session.execute_write(reset_tx)

    def counts(self):
        return {key: self._query(query)[0]["n"] for key, query in (
            ("roots", "MATCH (r:OP2_ROOT) RETURN count(r) AS n"),
            ("paths", "MATCH ()-[h:OP2_HAS_STEP]->() RETURN count(h) AS n"),
            ("steps", "MATCH (s:OP2_STEP) RETURN count(s) AS n"),
            ("edges", "MATCH ()-[e:OP2_NEXT_STEP]->() RETURN count(e) AS n"),
        )}

    def weights(self):
        return [(r["path_id"], r["weight"]) for r in self._query("""
          MATCH ()-[h:OP2_HAS_STEP]->()
          RETURN h.pathId AS path_id,h.weight AS weight ORDER BY path_id""")]

    def root_visits(self):
        return {r["domain"]: r["count"] for r in self._query("""
          MATCH (r:OP2_ROOT) RETURN r.domain AS domain,r.visitCount AS count
          ORDER BY domain""")}

    def touched_state(self, path_ids):
        ids = sorted(path_ids)
        if not ids:
            return {}
        rows = self._query("""UNWIND $ids AS pid
          OPTIONAL MATCH ()-[h:OP2_HAS_STEP {pathId:pid}]->()
          OPTIONAL MATCH (s:OP2_STEP {pathId:pid})
          OPTIONAL MATCH ()-[e:OP2_NEXT_STEP {pathId:pid}]->()
          RETURN pid,h.weight AS has_weight,
            min(s.usageCount) AS step_min,max(s.usageCount) AS step_max,
            count(DISTINCT s) AS step_count,
            min(e.weight) AS edge_min,max(e.weight) AS edge_max,
            count(DISTINCT e) AS edge_count""", ids=ids)
        return {str(r["pid"]): {"has_weight": r["has_weight"],
                                "step": (r["step_min"], r["step_max"], r["step_count"]),
                                "edge": (r["edge_min"], r["edge_max"], r["edge_count"])}
                for r in rows}

    def iter_rows(self, kind):
        """전체 payload 정합용 Bolt streaming 결과. 측정 구간 밖에서만 사용."""
        queries = {
            "root": """MATCH (r:OP2_ROOT) RETURN r.domain AS domain,
              r.baseURL AS baseURL,r.visitCount AS visitCount ORDER BY domain""",
            "has": """MATCH (r:OP2_ROOT)-[h:OP2_HAS_STEP]->(s:OP2_STEP)
              RETURN h.pathId AS pathId,r.domain AS domain,s.stepId AS firstStepId,
              h.taskIntent AS taskIntent,h.weight AS weight ORDER BY pathId""",
            "step": """MATCH (s:OP2_STEP)
              RETURN s.stepId AS stepId,s.pathId AS pathId,s.ordinal AS ordinal,
              s.url AS url,s.domain AS domain,s.selectors AS selectors,
              s.action AS action,s.description AS description,s.isInput AS isInput,
              s.shouldWait AS shouldWait,s.textLabels AS textLabels,
              s.successRate AS successRate,s.usageCount AS usageCount
              ORDER BY pathId,ordinal""",
            "edge": """MATCH (a:OP2_STEP)-[e:OP2_NEXT_STEP]->(b:OP2_STEP)
              RETURN e.pathId AS pathId,e.sequenceOrder AS sequenceOrder,
              a.stepId AS fromId,b.stepId AS toId,e.weight AS weight
              ORDER BY pathId,sequenceOrder""",
        }
        with self.driver.session(database="neo4j", fetch_size=1000) as session:
            for row in session.run(queries[kind]):
                yield dict(row)


class Neo4jSourceShapeStore(Neo4jStore):
    """원본 save_path의 ROOT→각 STEP→각 관계별 독립 graph.query 형태.

    임베딩과 API 계층은 양쪽 운영 실험 범위 밖이다. 이 클래스는 1k 규모의
    별도 Neo4j 내부 진단에서만 사용하며 주 엔진 비교에는 섞지 않는다.
    """

    name = "neo4j_source_shape"

    def register(self, record):
        self._query("""MATCH (r:OP2_ROOT {domain:$domain})
          SET r.visitCount=r.visitCount+1""", domain=record["domain"])
        previous = None
        for step in step_rows(record):
            self._query("""MERGE (s:OP2_STEP {stepId:$row.stepId})
              ON CREATE SET s = $row
              ON MATCH SET s.usageCount=s.usageCount+1""", row=step)
            if previous is None:
                self._query("""MATCH (r:OP2_ROOT {domain:$domain})
                  MATCH (s:OP2_STEP {stepId:$step_id})
                  MERGE (r)-[h:OP2_HAS_STEP {pathId:$path_id}]->(s)
                  ON CREATE SET h.taskIntent=$intent,h.weight=1
                  ON MATCH SET h.weight=h.weight+1""",
                    domain=record["domain"], step_id=step["stepId"],
                    path_id=record["path_id"], intent=record["intent"])
            else:
                self._query("""MATCH (a:OP2_STEP {stepId:$from_id})
                  MATCH (b:OP2_STEP {stepId:$to_id})
                  MERGE (a)-[e:OP2_NEXT_STEP {pathId:$path_id,
                    sequenceOrder:$ordinal}]->(b)
                  ON CREATE SET e.weight=1
                  ON MATCH SET e.weight=e.weight+1""",
                    from_id=previous, to_id=step["stepId"],
                    path_id=record["path_id"], ordinal=step["ordinal"])
            previous = step["stepId"]

    def update(self, path_id):
        self.register(path_record(path_id, "uniform"))
