#!/usr/bin/env python3
"""동결된 Vowser 검색 평가 자료를 원본 WebSocket 경로로 실행·집계한다."""

import argparse
import asyncio
from collections import Counter, defaultdict
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import statistics
import time
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
RUN = HERE / "run"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def append(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as output:
        output.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n")


def validate() -> tuple[list[dict], list[dict], dict]:
    manifest = json.loads((HERE / "freeze_manifest.json").read_text(encoding="utf-8"))
    for name, expected in manifest["files_sha256"].items():
        actual = hashlib.sha256((HERE / name).read_bytes()).hexdigest()
        if actual != expected:
            raise RuntimeError(f"freeze mismatch: {name}")
    paths = rows(HERE / "registered_paths.jsonl")
    gold = rows(HERE / "gold.jsonl")
    ids = {p["id"] for p in paths}
    if len(paths) != len(ids) or len(gold) != len({g["id"] for g in gold}):
        raise RuntimeError("duplicate ID")
    if len(paths) != manifest["paths"] or len(gold) != manifest["queries_total"]:
        raise RuntimeError("manifest count mismatch")
    for item in gold:
        expected = [item["expected_id"]] if item["kind"] == "answerable" else item.get("acceptable_ids", [])
        if not set(expected) <= ids:
            raise RuntimeError(f"unknown expected path: {item['id']}")
    return paths, gold, manifest


def package_versions() -> dict:
    versions = {"python": platform.python_version(), "platform": platform.platform()}
    for package in ("fastapi", "langgraph", "langchain-neo4j", "langchain-openai", "openai", "neo4j", "websockets", "numpy"):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    return versions


def redact(value):
    secret = os.getenv("OPENAI_API_KEY", "")
    db_secret = os.getenv("NEO4J_PASSWORD", "")
    if isinstance(value, str):
        for token in (secret, db_secret):
            if token:
                value = value.replace(token, "[REDACTED]")
        return value
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, dict):
        return {k: redact(v) for k, v in value.items()}
    return value


def trace_lines(path: Path | None) -> list[dict] | None:
    if path is None:
        return None
    if not path.exists():
        return []
    return rows(path)


async def request(ws, kind: str, data: dict, timeout: float) -> tuple[dict, float]:
    started = time.perf_counter_ns()
    await ws.send(json.dumps({"type": kind, "data": data}, ensure_ascii=False))
    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
    elapsed_ms = (time.perf_counter_ns() - started) / 1e6
    return json.loads(raw), round(elapsed_ms, 3)


async def register(uri: str, timeout: float) -> None:
    import websockets

    paths, _, manifest = validate()
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY absent: refuse synthetic registration without original embeddings")
    output = RUN / "registration_raw.jsonl"
    if output.exists():
        raise RuntimeError(f"registration output exists: {output}")
    RUN.mkdir(parents=True, exist_ok=True)
    (RUN / "environment.json").write_text(json.dumps({"started_utc": now(), "uri": uri, "versions": package_versions(), "freeze": manifest["files_sha256"]}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    async with websockets.connect(uri, max_size=10_000_000, open_timeout=10) as ws:
        for path in paths:
            item = {"id": path["id"], "sent_utc": now()}
            try:
                result, elapsed = await request(ws, "save_new_path", path["submission"], timeout)
                item.update({"elapsed_ms": elapsed, "response": redact(result), "ok": result.get("status") == "success" and result.get("data", {}).get("result", {}).get("status") == "success"})
            except Exception as error:
                item.update({"ok": False, "error_type": type(error).__name__, "error": redact(str(error))})
            append(output, item)
            print(f"register {path['id']}: {'ok' if item['ok'] else 'FAIL'}")
            if not item["ok"]:
                raise RuntimeError(f"registration failed for {path['id']}; see raw file")
        graph_result, graph_elapsed = await request(ws, "check_graph", {}, timeout)
        (RUN / "graph_stats.json").write_text(json.dumps(redact({"elapsed_ms": graph_elapsed, "response": graph_result}), ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        stats = (graph_result.get("data") or {}).get("graph_statistics") or {}
        if graph_result.get("status") != "success" or stats.get("HAS_STEP_relations") != len(paths):
            raise RuntimeError(f"graph contains {stats.get('HAS_STEP_relations')} registered paths; expected {len(paths)}")


async def search(uri: str, timeout: float, trace_path: Path | None) -> None:
    import websockets

    paths, gold, _ = validate()
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY absent: refuse heuristic fallback as original AI evaluation")
    registered = rows(RUN / "registration_raw.jsonl")
    if len(registered) != len(paths) or not all(r["ok"] for r in registered):
        raise RuntimeError("all 16 paths must be registered successfully")
    output = RUN / "search_raw.jsonl"
    if output.exists():
        raise RuntimeError(f"search output exists: {output}; preserve the frozen one-pass run")
    map_id = {(p["submission"]["domain"], p["submission"]["taskIntent"]): p["id"] for p in paths}
    for item in gold:
        trace_before = trace_lines(trace_path)
        record = {"id": item["id"], "kind": item["kind"], "expression_type": item["expression_type"], "query": item["query"], "sent_utc": now()}
        try:
            # 각 질의별 연결: 타임아웃으로 늦게 온 응답이 다음 질의에 귀속되지 않게 한다.
            async with websockets.connect(uri, max_size=20_000_000, open_timeout=10) as ws:
                result, elapsed = await request(ws, "search_new_path", {"query": item["query"], "limit": 3}, timeout)
            data = result.get("data") or {}
            valid_envelope = result.get("type") == "search_path_result" and data.get("query") == item["query"]
            matches = data.get("matched_paths", []) if result.get("status") == "success" and valid_envelope else []
            valid_matches = isinstance(matches, list)
            record.update({"elapsed_ms": elapsed, "response": redact(result), "returned_ids": [map_id.get((p.get("domain"), p.get("taskIntent")), None) for p in matches] if valid_matches else [], "ok": bool(result.get("status") == "success" and valid_envelope and valid_matches)})
            if not valid_envelope:
                record["error_type"] = "ResponseMismatch"
                record["error"] = "response type or query differs from request"
        except Exception as error:
            record.update({"ok": False, "error_type": type(error).__name__, "error": redact(str(error)), "returned_ids": []})
        trace_after = trace_lines(trace_path)
        if trace_before is not None and trace_after is not None:
            new_events = trace_after[len(trace_before):]
            record["llm_call_attempted"] = any(e.get("event") == "start" for e in new_events)
            record["llm_call_succeeded"] = any(e.get("event") == "end" for e in new_events)
            record["llm_trace_events"] = new_events
        else:
            record["llm_call_attempted"] = None
            record["llm_call_succeeded"] = None
        append(output, record)
        print(f"search {item['id']}: {'ok' if record['ok'] else 'FAIL'}")


def wilson(success: int, total: int) -> list[float] | None:
    if not total:
        return None
    z = 1.95996398454
    p = success / total
    d = 1 + z * z / total
    center = (p + z * z / (2 * total)) / d
    spread = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d
    return [round(max(0, center - spread), 4), round(min(1, center + spread), 4)]


def score(gold: dict, result: dict) -> dict:
    found = result.get("returned_ids", [])
    if gold["kind"] == "answerable":
        target = gold["expected_id"]
        return {"top1": bool(result.get("ok") and found and found[0] == target), "top3": bool(result.get("ok") and target in found[:3])}
    if gold["kind"] == "ambiguous":
        return {"acceptable_top1": bool(result.get("ok") and found and found[0] in gold["acceptable_ids"]), "acceptable_top3": bool(result.get("ok") and set(found[:3]) & set(gold["acceptable_ids"]))}
    return {"abstained": bool(result.get("ok") and not found)}


def pct(s: int, n: int) -> str:
    return f"{s}/{n} ({100*s/n:.1f}%)" if n else "0/0"


def report() -> None:
    paths, gold, manifest = validate()
    raw = rows(RUN / "search_raw.jsonl")
    registered = rows(RUN / "registration_raw.jsonl")
    if len(raw) != len(gold) or len({r["id"] for r in raw}) != len(gold):
        raise RuntimeError("incomplete run: all 96 searches required, failures included in denominator")
    result_map = {r["id"]: r for r in raw}
    if set(result_map) != {g["id"] for g in gold}:
        raise RuntimeError("search IDs differ from frozen gold")
    scored = [(g, result_map[g["id"]], score(g, result_map[g["id"]])) for g in gold]
    answerable = [x for x in scored if x[0]["kind"] == "answerable"]
    ambiguous = [x for x in scored if x[0]["kind"] == "ambiguous"]
    unanswerable = [x for x in scored if x[0]["kind"] == "unanswerable"]
    top1 = sum(s["top1"] for _, _, s in answerable)
    top3 = sum(s["top3"] for _, _, s in answerable)
    types = {}
    for kind in sorted({g["expression_type"] for g, _, _ in answerable}):
        subset = [s for g, _, s in answerable if g["expression_type"] == kind]
        types[kind] = {"n": len(subset), "top1": sum(s["top1"] for s in subset), "top3": sum(s["top3"] for s in subset)}
    latencies = [r["elapsed_ms"] for r in raw if r.get("elapsed_ms") is not None]
    stats = json.loads((RUN / "graph_stats.json").read_text(encoding="utf-8"))["response"]["data"]["graph_statistics"]
    summary = {
        "generated_utc": now(), "registered_path_count": stats["HAS_STEP_relations"], "registered_success_count": sum(r.get("ok", False) for r in registered),
        "answerable": {"n": len(answerable), "top1": top1, "top3": top3, "top1_wilson95": wilson(top1, len(answerable)), "top3_wilson95": wilson(top3, len(answerable)), "by_expression_type": types},
        "ambiguous": {"n": len(ambiguous), "acceptable_top1": sum(s["acceptable_top1"] for _, _, s in ambiguous), "acceptable_top3": sum(s["acceptable_top3"] for _, _, s in ambiguous)},
        "unanswerable": {"n": len(unanswerable), "abstained": sum(s["abstained"] for _, _, s in unanswerable)},
        "search_failure_count": sum(not r.get("ok", False) for r in raw), "llm_attempt_observed_count": sum(r.get("llm_call_attempted") is True for r in raw), "llm_success_observed_count": sum(r.get("llm_call_succeeded") is True for r in raw), "llm_unknown_count": sum(r.get("llm_call_attempted") is None for r in raw),
        "latency_wall_ms": {"n": len(latencies), "median": round(statistics.median(latencies), 2) if latencies else None, "p95": round(sorted(latencies)[math.ceil(0.95 * len(latencies)) - 1], 2) if latencies else None},
        "freeze_sha256": manifest["files_sha256"],
    }
    (RUN / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    lines = [
        "# Vowser 실제 표현별 경로 검색 평가", "",
        "## 범위와 정답 기준", "",
        f"- 등록 합성 경로: Neo4j HAS_STEP 관계 {summary['registered_path_count']}개, 등록 응답 성공 {summary['registered_success_count']}/{len(paths)}개. 클릭 URL과 선택자는 검색 구조 검사용이며 실제 웹 작업의 동작 검증 자료가 아님.",
        "- 문장: 에이전트가 직접 작성한 합성 한국어 96개. 실제 사용자 발화나 STT 정확도 표본이 아님.",
        "- 정답: answerable에서는 등록된 `(domain, taskIntent)` 하나와 일치하면 정답. 중복 도메인의 다른 작업은 오답. 검색 실패·빈 결과는 분모에 포함한 오답.",
        "- ambiguous 8개는 복수 허용 후보를 별도 측정하며 Top1 주분모에서 제외. unanswerable 8개는 경로 미반환을 별도 측정.",
        "- 정답·등록 데이터 SHA-256은 실행 전 freeze_manifest.json에 고정. 결과 관찰 후 변경하지 않음.", "",
        "## 결과", "",
        f"- 정답형 Top1: **{pct(top1, len(answerable))}**, Wilson 95% CI {summary['answerable']['top1_wilson95']}.",
        f"- 정답형 Top3: **{pct(top3, len(answerable))}**, Wilson 95% CI {summary['answerable']['top3_wilson95']}.",
        f"- 다의 문장 허용 후보 Top1: {pct(summary['ambiguous']['acceptable_top1'], len(ambiguous))}; Top3: {pct(summary['ambiguous']['acceptable_top3'], len(ambiguous))}.",
        f"- 미등록 요청 무응답: {pct(summary['unanswerable']['abstained'], len(unanswerable))}.",
        f"- 검색 실패: {summary['search_failure_count']}/{len(gold)}. 원시 왕복 지연 중앙값 {summary['latency_wall_ms']['median']} ms, p95 {summary['latency_wall_ms']['p95']} ms.",
        f"- LLM 호출 시도 관측 {summary['llm_attempt_observed_count']}/{len(gold)}, 성공 관측 {summary['llm_success_observed_count']}/{len(gold)}, 관측 불가 {summary['llm_unknown_count']}/{len(gold)}.", "",
        "| 표현 유형 | Top1 | Top3 |", "| --- | ---: | ---: |",
    ]
    for kind, item in types.items():
        lines.append(f"| {kind} | {pct(item['top1'], item['n'])} | {pct(item['top3'], item['n'])} |")
    lines += ["", "## Top1 오답·실패", "", "| ID | 질문 | 정답 | Top1 | 상태 |", "| --- | --- | --- | --- | --- |"]
    for g, r, s in answerable:
        if not s["top1"]:
            first = (r.get("returned_ids") or [None])[0]
            lines.append(f"| {g['id']} | {g['query']} | {g['expected_id']} | {first or '없음'} | {'응답' if r.get('ok') else '실패'} |")
    lines += ["", "## 재현 자료", "", "- `registered_paths.jsonl`, `gold.jsonl`, `freeze_manifest.json`: 입력과 사전 정답", "- `run/registration_raw.jsonl`, `run/search_raw.jsonl`: 모든 원시 응답·지연·LLM 추적", "- `run/environment.json`, `run/summary.json`: 도구 버전과 결과 집계", "- `run_eval.py`, `serve_traced.py`: 등록·검색·관측 재현 코드", ""]
    (RUN / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def bootstrap(uri: str, user: str, password: str) -> None:
    from neo4j import GraphDatabase

    if not password:
        raise RuntimeError("NEO4J_PASSWORD absent")
    driver = GraphDatabase.driver(uri, auth=(user, password))
    with driver:
        driver.verify_connectivity()
        with driver.session() as session:
            prior = session.run("MATCH (n) RETURN count(n) AS n").single()["n"]
            if prior:
                raise RuntimeError(f"DB is not isolated: {prior} nodes already exist")
            session.run("CREATE VECTOR INDEX intent_embeddings IF NOT EXISTS FOR ()-[r:HAS_STEP]-() ON (r.intentEmbedding) OPTIONS {indexConfig: {`vector.dimensions`: 1536, `vector.similarity_function`: 'cosine'}}").consume()
            for _ in range(30):
                result = session.run("SHOW INDEXES YIELD name, state WHERE name = 'intent_embeddings' RETURN state").single()
                if result and result["state"] == "ONLINE":
                    break
                time.sleep(1)
            else:
                raise RuntimeError("intent_embeddings index did not become ONLINE")
    print("intent_embeddings index ONLINE; isolated DB confirmed")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("validate", "bootstrap", "register", "search", "report"))
    parser.add_argument("--ws", default="ws://127.0.0.1:19429/ws")
    parser.add_argument("--bolt", default=os.getenv("NEO4J_URI", "bolt://127.0.0.1:19687"))
    parser.add_argument("--neo4j-user", default=os.getenv("NEO4J_USERNAME", "neo4j"))
    parser.add_argument("--trace-file", type=Path, default=None)
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()
    if args.phase in ("register", "search") and args.ws != "ws://127.0.0.1:19429/ws":
        raise RuntimeError("evaluation WebSocket must be ws://127.0.0.1:19429/ws")
    if args.phase == "validate":
        paths, gold, manifest = validate()
        print(json.dumps({"paths": len(paths), "gold": len(gold), "sha256": manifest["files_sha256"]}, ensure_ascii=False, indent=2))
    elif args.phase == "bootstrap":
        validate()
        bootstrap(args.bolt, args.neo4j_user, os.getenv("NEO4J_PASSWORD", ""))
    elif args.phase == "register":
        asyncio.run(register(args.ws, args.timeout))
    elif args.phase == "search":
        asyncio.run(search(args.ws, args.timeout, args.trace_file))
    elif args.phase == "report":
        report()


if __name__ == "__main__":
    main()
