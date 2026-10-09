#!/usr/bin/env python3
"""OOM 후 부분 적재 Neo4j의 불완전 경로·STEP 수를 읽기 전용 보존."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from shared.connect import neo4j_driver
from search.build_inputs import checksum

HERE = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", required=True)
    parser.add_argument("--condition", required=True)
    args = parser.parse_args()
    output = HERE / "evidence" / f"{args.label}.json"
    if output.exists():
        raise RuntimeError("partial evidence exists")
    driver = neo4j_driver()
    try:
        with driver.session() as session:
            row = session.run("MATCH (r:SR1_ROOT) WITH count(r) AS roots MATCH (s:SR1_STEP) WITH roots,count(s) AS steps MATCH ()-[h:SR1_HAS_STEP]->() WITH roots,steps,count(h) AS heads MATCH ()-[e:SR1_NEXT_STEP]->() RETURN roots,steps,heads,count(e) AS edges").single()
            counts = row.data() if row else None
            indexes = session.run("SHOW INDEXES YIELD name,state,type WHERE name STARTS WITH 'sr1_' RETURN name,state,type").data()
    finally:
        driver.close()
    result = {"condition": args.condition, "complete_fixture": False,
              "search_attempts": 0, "counts": counts, "indexes": indexes,
              "collector_sha256": checksum(Path(__file__))}
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "sha256": checksum(output),
                      "counts": counts, "indexes": indexes}, sort_keys=True))


if __name__ == "__main__":
    main()
