#!/usr/bin/env python3
"""원본 FastAPI를 그대로 구동하며 GPT 의도 분석 호출만 별도 기록한다."""

import json
import os
from pathlib import Path
import time
from datetime import datetime, timezone


def main() -> None:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY absent: original AI path cannot run")
    if not all(os.getenv(name) for name in ("NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD")):
        raise RuntimeError("Neo4j connection environment incomplete")
    path = Path(os.environ.get("VOWSER_EVAL_LLM_TRACE", "/tmp/vowser-eval-retrieval/llm_calls.jsonl"))
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise RuntimeError(f"trace file already exists: {path}")
    from langchain_openai import ChatOpenAI
    original = ChatOpenAI.ainvoke

    async def observed(self, input, config=None, **kwargs):
        started = time.perf_counter_ns()
        with path.open("a", encoding="utf-8") as out:
            out.write(json.dumps({"event": "start", "utc": datetime.now(timezone.utc).isoformat(), "model": self.model_name}) + "\n")
        try:
            result = await original(self, input, config=config, **kwargs)
            event = {"event": "end", "utc": datetime.now(timezone.utc).isoformat(), "model": self.model_name, "elapsed_ms": round((time.perf_counter_ns() - started) / 1e6, 3)}
            with path.open("a", encoding="utf-8") as out:
                out.write(json.dumps(event) + "\n")
            return result
        except Exception as error:
            event = {"event": "error", "utc": datetime.now(timezone.utc).isoformat(), "model": self.model_name, "elapsed_ms": round((time.perf_counter_ns() - started) / 1e6, 3), "error_type": type(error).__name__}
            with path.open("a", encoding="utf-8") as out:
                out.write(json.dumps(event) + "\n")
            raise

    ChatOpenAI.ainvoke = observed
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=19429, log_level="warning")


if __name__ == "__main__":
    main()
