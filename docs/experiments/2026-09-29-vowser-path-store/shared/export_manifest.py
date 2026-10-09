#!/usr/bin/env python3
"""경로별 조인 키 manifest를 streaming JSONL로 내보냄."""

import argparse
import json
from pathlib import Path

from shared.data import SCALES, domain_id, intent_id, path_record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--total", type=int, choices=SCALES, required=True)
    parser.add_argument("--distribution", choices=("uniform", "skew"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w") as f:
        for path_id in range(args.total):
            record = path_record(path_id, args.distribution)
            row = {
                "path_id": path_id,
                "domain_id": domain_id(path_id, args.distribution),
                "domain": record["domain"],
                "intent_id": intent_id(path_id),
                "intent": record["intent"],
                "depth": record["depth"],
                "session_id": record["session_id"],
                "first_step_id": record["steps"][0]["step_id"],
            }
            f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {args.total} {args.distribution} paths to {args.output}")


if __name__ == "__main__":
    main()
