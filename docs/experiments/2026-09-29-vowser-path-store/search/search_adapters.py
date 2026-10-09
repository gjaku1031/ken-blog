#!/usr/bin/env python3
"""원본 조회 흐름 어댑터·단일 쿼리 Neo 개선안·MySQL+임베디드 FAISS."""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import numpy as np

from shared.connect import mysql_connection, neo4j_driver
from search.build_inputs import DIM

CUTOFF = 0.3
FIELDS = ("url", "action", "selectors", "description", "isInput", "inputType", "inputPlaceholder", "shouldWait", "waitMessage", "textLabels")


def ms(start_ns: int) -> float:
    return round((time.perf_counter_ns() - start_ns) / 1_000_000, 3)


def serialized_bytes(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8"))


def formatted_steps(nodes: list[dict]) -> list[dict]:
    return [{"order": i, **{field: node.get(field) for field in FIELDS}} for i, node in enumerate(nodes)]


def make_path(domain: str, intent: str, score: float, weight: int, nodes: list[dict]) -> dict:
    return {"domain": domain, "taskIntent": intent, "relevance_score": round(float(score), 3), "weight": int(weight), "steps": formatted_steps(nodes)}


NEO_ORIGINAL_UNHINTED = """
CALL db.index.vector.queryRelationships('sr1_intent_embeddings', $topK, $queryEmbedding)
YIELD relationship AS rel
WITH rel
MATCH (r:SR1_ROOT)-[rel]->(firstStep:SR1_STEP)
WHERE rel.intentEmbedding IS NOT NULL
RETURN r.domain AS domain, r.domain AS baseURL,
       rel.taskIntent AS taskIntent, rel.intentEmbedding AS intentEmbedding,
       rel.weight AS weight, firstStep.stepId AS stepId,
       rel.pathId AS pathId
LIMIT $limit
"""
NEO_ORIGINAL_HINTED = """
CALL db.index.vector.queryRelationships('sr1_intent_embeddings', $topK, $queryEmbedding)
YIELD relationship AS rel
WITH rel
MATCH (r:SR1_ROOT {domain:$domain})-[rel]->(firstStep:SR1_STEP)
WHERE rel.intentEmbedding IS NOT NULL
RETURN r.domain AS domain, r.domain AS baseURL,
       rel.taskIntent AS taskIntent, rel.intentEmbedding AS intentEmbedding,
       rel.weight AS weight, firstStep.stepId AS stepId,
       rel.pathId AS pathId
LIMIT $limit
"""
NEO_ORIGINAL_PATH = """
MATCH path = (start:SR1_STEP {stepId:$startStepId})-[:SR1_NEXT_STEP*0..20]->(end:SR1_STEP)
WHERE NOT (end)-[:SR1_NEXT_STEP]->()
RETURN [node IN nodes(path) | {
  url:node.url, action:node.action, selectors:node.selectors,
  description:node.description, isInput:node.isInput,
  inputType:node.inputType, inputPlaceholder:node.inputPlaceholder,
  shouldWait:node.shouldWait, waitMessage:node.waitMessage,
  textLabels:node.textLabels
}] AS steps
LIMIT 1
"""

NEO_OPTIMIZED_UNHINTED = """
CALL db.index.vector.queryRelationships('sr1_intent_embeddings', $topK, $queryEmbedding)
YIELD relationship AS rel
MATCH (r:SR1_ROOT)-[rel]->(start:SR1_STEP)
WITH r,rel,start,2.0*vector.similarity.cosine(rel.intentEmbedding,$queryEmbedding)-1.0 AS rawScore
WHERE rawScore > 0.3
ORDER BY rawScore DESC, rel.pathId ASC
LIMIT $limit
MATCH path=(start)-[:SR1_NEXT_STEP*0..20]->(end:SR1_STEP)
WHERE NOT (end)-[:SR1_NEXT_STEP]->()
RETURN r.domain AS domain,rel.taskIntent AS taskIntent,rel.weight AS weight,
       rel.pathId AS pathId,rawScore AS rawScore,
       [node IN nodes(path) | {
         url:node.url, action:node.action, selectors:node.selectors,
         description:node.description, isInput:node.isInput,
         inputType:node.inputType, inputPlaceholder:node.inputPlaceholder,
         shouldWait:node.shouldWait, waitMessage:node.waitMessage,
         textLabels:node.textLabels
       }] AS steps
ORDER BY rawScore DESC,pathId ASC
"""
NEO_OPTIMIZED_HINTED = """
MATCH (r:SR1_ROOT {domain:$domain})-[rel:SR1_HAS_STEP]->(start:SR1_STEP)
WITH r,rel,start,2.0*vector.similarity.cosine(rel.intentEmbedding,$queryEmbedding)-1.0 AS rawScore
WHERE rawScore > 0.3
ORDER BY rawScore DESC, rel.pathId ASC
LIMIT $limit
MATCH path=(start)-[:SR1_NEXT_STEP*0..20]->(end:SR1_STEP)
WHERE NOT (end)-[:SR1_NEXT_STEP]->()
RETURN r.domain AS domain,rel.taskIntent AS taskIntent,rel.weight AS weight,
       rel.pathId AS pathId,rawScore AS rawScore,
       [node IN nodes(path) | {
         url:node.url, action:node.action, selectors:node.selectors,
         description:node.description, isInput:node.isInput,
         inputType:node.inputType, inputPlaceholder:node.inputPlaceholder,
         shouldWait:node.shouldWait, waitMessage:node.waitMessage,
         textLabels:node.textLabels
       }] AS steps
ORDER BY rawScore DESC,pathId ASC
"""


class NeoSearch:
    def __init__(self):
        # NULL 선택 속성은 Neo4j에 물리 저장되지 않아 컴파일러가 반복 알림을 낸다.
        # 이미 스모크에 원문 경고를 보존했으며 본측정의 stderr 출력 비용은 제외한다.
        logging.getLogger("neo4j.notifications").setLevel(logging.ERROR)
        self.driver = neo4j_driver()

    def close(self) -> None:
        self.driver.close()

    def index_candidate_ids(self, vector: np.ndarray, count: int) -> list[int]:
        """타이밍 밖 ANN 후보 품질 검증. 결과 재구성에는 사용하지 않음."""
        query = "CALL db.index.vector.queryRelationships('sr1_intent_embeddings',$topK,$queryEmbedding) YIELD relationship AS rel RETURN rel.pathId AS pathId"
        with self.driver.session() as session:
            rows = session.run(query, topK=count, queryEmbedding=np.asarray(vector, dtype=np.float32).astype(float).tolist()).data()
        return [int(row["pathId"]) for row in rows]

    def original(self, vector: np.ndarray, limit: int, domain: str | None) -> dict:
        """원본 함수의 후보 LIMIT→Python 코사인→후보별 경로 조회 순서를 재현."""
        started = time.perf_counter_ns()
        query_vector = np.asarray(vector, dtype=np.float32)
        kwargs = {"topK": limit * 5, "queryEmbedding": query_vector.astype(float).tolist(), "limit": limit}
        if domain is not None:
            kwargs["domain"] = domain
        phases: dict[str, float] = {}
        roundtrips = 0
        with self.driver.session() as session:
            segment = time.perf_counter_ns()
            candidates = session.run(NEO_ORIGINAL_HINTED if domain else NEO_ORIGINAL_UNHINTED, **kwargs).data()
            phases["ann_and_domain_ms"] = ms(segment)
            roundtrips += 1
            segment = time.perf_counter_ns()
            ranked = []
            for item in candidates:
                embedding = np.asarray(item["intentEmbedding"], dtype=np.float32)
                if embedding.shape != query_vector.shape:
                    score = 0.0
                else:
                    denominator = float(np.linalg.norm(query_vector) * np.linalg.norm(embedding))
                    score = float(np.dot(query_vector, embedding) / denominator) if denominator else 0.0
                if score > CUTOFF:
                    ranked.append((score, item))
            ranked.sort(key=lambda pair: pair[0], reverse=True)
            ranked = ranked[:limit]
            phases["python_cosine_ms"] = ms(segment)
            paths, ids, scores, path_rows = [], [], [], []
            segment = time.perf_counter_ns()
            for score, item in ranked:
                row = session.run(NEO_ORIGINAL_PATH, startStepId=item["stepId"]).single()
                roundtrips += 1
                data = row.data() if row else None
                path_rows.append(data)
                if not data:
                    continue
                ids.append(int(item["pathId"]))
                scores.append(score)
                paths.append(make_path(item["domain"], item["taskIntent"], score, item["weight"], data["steps"]))
            phases["path_reconstruction_ms"] = ms(segment)
        segment = time.perf_counter_ns()
        payload = {"matched_paths": paths, "total_matched": len(paths)}
        payload_bytes = serialized_bytes(payload)
        phases["json_serialization_ms"] = ms(segment)
        elapsed_ms = ms(started)
        db_bytes = serialized_bytes(candidates) + sum(serialized_bytes(item) for item in path_rows)
        return {"path_ids": ids, "raw_scores": scores, "payload": payload, "phases_ms": phases, "db_roundtrips": roundtrips, "db_return_estimated_bytes": db_bytes, "json_bytes": payload_bytes, "candidate_count": len(candidates), "candidate_ids": [int(row["pathId"]) for row in candidates], "elapsed_ms": elapsed_ms}

    def optimized(self, vector: np.ndarray, limit: int, domain: str | None, candidate_k: int) -> dict:
        started = time.perf_counter_ns()
        kwargs = {"topK": candidate_k, "queryEmbedding": np.asarray(vector, dtype=np.float32).astype(float).tolist(), "limit": limit}
        if domain is not None:
            kwargs["domain"] = domain
        segment = time.perf_counter_ns()
        with self.driver.session() as session:
            rows = session.run(NEO_OPTIMIZED_HINTED if domain else NEO_OPTIMIZED_UNHINTED, **kwargs).data()
        db_ms = ms(segment)
        segment = time.perf_counter_ns()
        paths = [make_path(row["domain"], row["taskIntent"], row["rawScore"], row["weight"], row["steps"]) for row in rows]
        payload = {"matched_paths": paths, "total_matched": len(paths)}
        payload_bytes = serialized_bytes(payload)
        format_ms = ms(segment)
        elapsed_ms = ms(started)
        db_bytes = serialized_bytes(rows)
        return {"path_ids": [int(row["pathId"]) for row in rows], "raw_scores": [float(row["rawScore"]) for row in rows], "payload": payload, "phases_ms": {"candidate_filter_path_db_ms": db_ms, "json_serialization_ms": format_ms}, "db_roundtrips": 1, "db_return_estimated_bytes": db_bytes, "json_bytes": payload_bytes, "candidate_count": candidate_k if domain is None else None, "elapsed_ms": elapsed_ms}


class MysqlFaissSearch:
    def __init__(self, expected_n: int, ef_search: int = 64):
        import faiss

        self.faiss = faiss
        self.connection = mysql_connection()
        self.connection.autocommit(True)
        self.ef_search = ef_search
        started = time.perf_counter_ns()
        with self.connection.cursor() as cur:
            cur.execute("SELECT path_id,domain_id,intent_embedding FROM sr1_path ORDER BY path_id")
            rows = cur.fetchall()
        if len(rows) != expected_n:
            raise RuntimeError(f"MySQL path count {len(rows)} != {expected_n}")
        self.vectors = np.empty((expected_n, DIM), dtype=np.float32)
        self.domains = np.empty(expected_n, dtype=np.int32)
        for position, (pid, domain_id, blob) in enumerate(rows):
            if pid != position:
                raise RuntimeError("path IDs must be contiguous")
            self.vectors[position] = np.frombuffer(blob, dtype=np.float32)
            self.domains[position] = int(domain_id)
        # BLOB fetchall 사본은 FAISS 전역·도메인 인덱스를 만들기 전에 해제한다.
        del rows, blob
        self.index = faiss.IndexHNSWFlat(DIM, 32, faiss.METRIC_INNER_PRODUCT)
        self.index.hnsw.efConstruction = 80
        self.index.add(self.vectors)
        self.domain_indexes = {}
        self.domain_members = {}
        for domain_id in range(30):
            members = np.flatnonzero(self.domains == domain_id).astype(np.int32)
            index = faiss.IndexHNSWFlat(DIM, 32, faiss.METRIC_INNER_PRODUCT)
            index.hnsw.efConstruction = 80
            if members.size:
                index.add(self.vectors[members])
            self.domain_indexes[domain_id] = index
            self.domain_members[domain_id] = members
        self.index_build_ms = ms(started)

    def close(self) -> None:
        self.connection.close()

    def index_candidate_ids(self, vector: np.ndarray, domain_id: int | None, count: int, ef_search: int) -> list[int]:
        index = self.index if domain_id is None else self.domain_indexes[domain_id]
        members = None if domain_id is None else self.domain_members[domain_id]
        index.hnsw.efSearch = ef_search
        _, local_ids = index.search(np.asarray(vector, dtype=np.float32).reshape(1, DIM), min(count, index.ntotal))
        return [int(i) if members is None else int(members[i]) for i in local_ids[0] if i >= 0]

    def search(self, vector: np.ndarray, limit: int, domain_id: int | None, candidate_k: int, ef_search: int | None = None) -> dict:
        started = time.perf_counter_ns()
        query = np.asarray(vector, dtype=np.float32).reshape(1, DIM)
        index = self.index if domain_id is None else self.domain_indexes[domain_id]
        members = None if domain_id is None else self.domain_members[domain_id]
        index.hnsw.efSearch = ef_search or self.ef_search
        segment = time.perf_counter_ns()
        _, local_ids = index.search(query, min(candidate_k, index.ntotal))
        ids = [int(i) if members is None else int(members[i]) for i in local_ids[0] if i >= 0]
        ann_ms = ms(segment)
        segment = time.perf_counter_ns()
        scored = [(float(np.dot(query[0], self.vectors[pid])), pid) for pid in ids]
        scored = [(score, pid) for score, pid in scored if score > CUTOFF]
        scored.sort(key=lambda pair: (-pair[0], pair[1]))
        selected = scored[:limit]
        cosine_ms = ms(segment)
        db_ms = 0.0
        db_bytes = 0
        roundtrips = 0
        rows = []
        if selected:
            segment = time.perf_counter_ns()
            placeholders = ",".join(["%s"] * len(selected))
            sql = "SELECT p.path_id,r.domain,p.task_intent,p.weight,s.ordinal,s.url,s.action,s.selectors,s.description,s.is_input,s.input_type,s.input_placeholder,s.should_wait,s.wait_message,s.text_labels FROM sr1_path p JOIN sr1_root r ON p.domain_id=r.domain_id JOIN sr1_step s ON s.path_id=p.path_id WHERE p.path_id IN (" + placeholders + ") ORDER BY p.path_id,s.ordinal"
            with self.connection.cursor() as cur:
                cur.execute(sql, [pid for _, pid in selected])
                rows = cur.fetchall()
            db_ms = ms(segment)
            roundtrips = 1
        segment = time.perf_counter_ns()
        grouped: dict[int, dict] = {}
        for row in rows:
            pid, domain, intent, weight, ordinal, url, action, selectors, description, is_input, input_type, input_placeholder, should_wait, wait_message, text_labels = row
            item = grouped.setdefault(pid, {"domain": domain, "intent": intent, "weight": weight, "steps": []})
            item["steps"].append({"url": url, "action": action, "selectors": json.loads(selectors), "description": description, "isInput": bool(is_input), "inputType": input_type, "inputPlaceholder": input_placeholder, "shouldWait": bool(should_wait), "waitMessage": wait_message, "textLabels": json.loads(text_labels)})
        paths, returned_ids, returned_scores = [], [], []
        for score, pid in selected:
            if pid in grouped:
                item = grouped[pid]
                returned_ids.append(pid)
                returned_scores.append(score)
                paths.append(make_path(item["domain"], item["intent"], score, item["weight"], item["steps"]))
        payload = {"matched_paths": paths, "total_matched": len(paths)}
        payload_bytes = serialized_bytes(payload)
        format_ms = ms(segment)
        elapsed_ms = ms(started)
        db_bytes = serialized_bytes(rows)
        return {"path_ids": returned_ids, "raw_scores": returned_scores, "payload": payload, "phases_ms": {"faiss_ann_ms": ann_ms, "python_cosine_ms": cosine_ms, "mysql_path_db_ms": db_ms, "json_serialization_ms": format_ms}, "db_roundtrips": roundtrips, "db_return_estimated_bytes": db_bytes, "json_bytes": payload_bytes, "candidate_count": len(ids), "candidate_ids": ids, "elapsed_ms": elapsed_ms}
