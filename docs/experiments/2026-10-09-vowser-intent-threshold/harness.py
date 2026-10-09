#!/usr/bin/env python3
"""Vowser 의도 검색의 두 분기 결과를 같은 요청에서 함께 기록하는 실행기.

원본 agent 서버(커밋 d94eaf5)의 함수를 고치지 않고 불러옴. 요청마다 원본과 같은 초기 상태로
유사도 검색·LLM 의도 분석을 한 번 실행한 뒤, 같은 상태에서 '바로 순위화' 분기와 'LLM 재검색' 분기를
각각 실행해 둘 다 기록함. 임계값은 분기 선택에만 쓰이므로, 임계값별 결과는 analyze.py가 이 기록에서 계산함.

실행: 원본 서버 디렉터리를 작업 디렉터리·PYTHONPATH로 두고
  python harness.py register
  python harness.py run confirmatory
  python harness.py run exploratory
필요한 환경 변수: OPENAI_API_KEY, NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD. 키 값은 기록하지 않음.
"""

import asyncio
import copy
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
SETS = {"confirmatory": HERE / "confirmatory_queries.jsonl", "exploratory": HERE / "exploratory_queries.jsonl"}


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ms(start: int) -> float:
    return round((time.perf_counter_ns() - start) / 1e6, 3)


def path_ids() -> dict:
    return {(p["submission"]["domain"], p["submission"]["taskIntent"]): p["id"] for p in rows(HERE / "registered_paths.jsonl")}


def ids_of(paths: list[dict], mapping: dict) -> list[str]:
    return [mapping.get((p.get("domain"), p.get("taskIntent")), f"unknown:{p.get('domain')}|{p.get('taskIntent')}") for p in paths]


def register() -> None:
    from app.models.step import PathSubmission
    from app.services import neo4j_service

    out = RAW / "registration.jsonl"
    if out.exists():
        raise SystemExit(f"이미 등록 기록이 있음: {out}")
    RAW.mkdir(exist_ok=True)
    for path in rows(HERE / "registered_paths.jsonl"):
        start = time.perf_counter_ns()
        result = neo4j_service.save_path_to_neo4j(PathSubmission(**path["submission"]))
        ok = isinstance(result, dict) and result.get("status") == "success"
        with out.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"id": path["id"], "ok": ok, "elapsed_ms": ms(start), "utc": now()}, ensure_ascii=False) + "\n")
        print(f"register {path['id']}: {'ok' if ok else 'FAIL'}")
        if not ok:
            raise SystemExit(f"등록 실패: {path['id']}: {result}")


async def run(set_name: str) -> None:
    from app.services import langgraph_service as lg

    out = RAW / f"{set_name}.jsonl"
    if out.exists():
        raise SystemExit(f"이미 실행 기록이 있음: {out}. 계획대로 한 번만 실행함")
    mapping = path_ids()
    for item in rows(SETS[set_name]):
        # 원본 search_with_langgraph와 같은 초기 상태, 상위 3개, 도메인 힌트 없음
        state = {
            "user_query": item["query"], "domain_hint": None, "limit": 3,
            "query_embedding": [], "intent_analysis": {}, "similarity_threshold": 0.0, "max_similarity": 0.0,
            "selected_paths": [], "processing_strategy": "", "reasoning": "", "cached_search_results": None,
        }
        record = {"id": item["id"], "utc": now()}
        try:
            start = time.perf_counter_ns()
            analyzed = await lg.analyze_similarity_and_intent_parallel(state)
            record["analysis_ms"] = ms(start)
            start = time.perf_counter_ns()
            ranked = await lg.rank_existing_paths(copy.deepcopy(analyzed))
            record["rank_ms"] = ms(start)
            start = time.perf_counter_ns()
            rediscovered = await lg.rediscover_with_different_agent(copy.deepcopy(analyzed))
            record["rediscover_ms"] = ms(start)
            intent = analyzed.get("intent_analysis") or {}
            record.update({
                "ok": True,
                "max_similarity": analyzed.get("max_similarity", 0.0),
                "rank_ids": ids_of(ranked["selected_paths"], mapping),
                "rediscover_ids": ids_of(rediscovered["selected_paths"], mapping),
                "llm_fallback": "폴백" in str(intent.get("reasoning", "")),
                "llm_keywords": intent.get("keywords", [])[:4],
            })
        except Exception as error:
            record.update({"ok": False, "error_type": type(error).__name__})
        with out.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        print(f"{set_name} {item['id']}: {'ok' if record['ok'] else 'FAIL'}")


if __name__ == "__main__":
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY 없음: 원본 LLM 경로를 실행할 수 없음")
    if sys.argv[1:2] == ["register"]:
        register()
    elif sys.argv[1:2] == ["run"] and len(sys.argv) == 3 and sys.argv[2] in SETS:
        asyncio.run(run(sys.argv[2]))
    else:
        raise SystemExit("사용: harness.py register | run confirmatory | run exploratory")
