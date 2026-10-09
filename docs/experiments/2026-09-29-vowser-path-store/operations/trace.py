#!/usr/bin/env python3
"""실험 2의 고정 mixed trace와 작업별 반환 oracle 생성."""

import argparse
import hashlib
import json
import random
from collections import Counter
from pathlib import Path

from shared.data import DEPTHS, SCALES, domain_id, intent_id, path_record

HERE = Path(__file__).resolve().parent
TRACES = HERE / "traces"


def path_meta(path_id, distribution):
    did = domain_id(path_id, distribution)
    iid = intent_id(path_id)
    return {
        "path_id": path_id,
        "domain_id": did,
        "domain": f"d{did:02d}.example.test",
        "intent": f"task-{iid:02d}",
        "depth": DEPTHS[path_id % 3],
    }


def build_trace(scale, mix, distribution):
    if scale not in SCALES or mix not in ("90:10", "50:50"):
        raise ValueError("invalid condition")
    if distribution == "skew" and scale != 10_000:
        raise ValueError("skew diagnostic is fixed to 10k")
    rng = random.Random(20260929 + scale + (10 if mix == "90:10" else 50) +
                        (100000 if distribution == "skew" else 0))
    base = scale - 10
    domains = {i: [] for i in range(30)}
    for path_id in range(scale):
        domains[domain_id(path_id, distribution)].append(path_id)
    hot = [i for i in range(min(base, 900))]
    if mix == "90:10":
        counts = {"popular": 90, "visualize": 90, "register": 10, "update": 10}
    else:
        counts = {"popular": 50, "visualize": 50, "register": 10, "update": 90}
    ops = []
    for kind in ("popular", "visualize"):
        # 입력 분포에 맞춘 고정 도메인 방문과 전체 연산 셔플.
        for index in range(counts[kind]):
            if distribution == "skew":
                # 집중 입력의 실제 hot domain도 읽기 부하 절반에 반영한다.
                did = 0 if index % 2 == 0 else 1 + (index // 2) % 29
            else:
                did = index % 30
            ops.append({"kind": kind, "domain_id": did,
                        "domain": f"d{did:02d}.example.test"})
    for path_id in range(base, scale):
        ops.append({"kind": "register", "path_id": path_id})
    for _ in range(counts["update"]):
        ops.append({"kind": "update", "path_id": rng.choice(hot)})
    rng.shuffle(ops)
    assert len(ops) == 200

    registered = [i < base for i in range(scale)]
    weight = [1] * scale
    base_root_count = Counter(domain_id(i, distribution) for i in range(base))
    base_root_count = {did: count - 1 for did, count in base_root_count.items()}
    root_count = dict(base_root_count)
    for sequence, op in enumerate(ops):
        op["seq"] = sequence
        kind = op["kind"]
        if kind == "register":
            path_id = op["path_id"]
            assert not registered[path_id]
            registered[path_id] = True
            root_count[domain_id(path_id, distribution)] += 1
        elif kind == "update":
            path_id = op["path_id"]
            assert registered[path_id]
            weight[path_id] += 1
            root_count[domain_id(path_id, distribution)] += 1
        else:
            did = op["domain_id"]
            selected = sorted((i for i in domains[did] if registered[i]),
                              key=lambda i: (-weight[i], i))[:10]
            if kind == "popular":
                op["expected"] = [{
                    "domain": f"d{did:02d}.example.test",
                    "taskIntent": path_meta(i, distribution)["intent"],
                    "usageCount": weight[i],
                    "firstStepDescription": f"task-{intent_id(i):02d} 0번째 단계",
                    "path_id": i,
                } for i in selected]
            else:
                op["expected"] = [{
                    "taskIntent": path_meta(i, distribution)["intent"],
                    "weight": weight[i],
                    "steps": ([s["description"] for s in path_record(i, distribution)["steps"]]
                              if DEPTHS[i % 3] <= 10 else None),
                    "pathLength": DEPTHS[i % 3] if DEPTHS[i % 3] <= 10 else None,
                    "path_id": i,
                } for i in selected]

    touched = {op["path_id"] for op in ops if op["kind"] == "update"}
    final_hash = hashlib.sha256("".join(f"{i}:{weight[i]}\n" for i in range(scale)).encode()).hexdigest()
    summary = {
        "scale_final": scale, "scale_initial": base, "new_paths": 10,
        "mix": mix, "distribution": distribution, "counts": counts,
        "rounds": 3, "ops_per_round": 200,
        "final_path_count": sum(registered),
        "base_root_visit_count": base_root_count,
        "final_root_visit_count": root_count,
        "updated_path_weights": {str(i): weight[i] for i in sorted(touched)},
        "final_has_weight_sha256": final_hash,
    }
    assert summary["final_path_count"] == scale
    return ops, summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scale", type=int, choices=SCALES, required=True)
    parser.add_argument("--mix", choices=("90:10", "50:50"), required=True)
    parser.add_argument("--distribution", choices=("uniform", "skew"), default="uniform")
    args = parser.parse_args()
    ops, summary = build_trace(args.scale, args.mix, args.distribution)
    TRACES.mkdir(exist_ok=True)
    stem = f"{args.distribution}-{args.scale}-{args.mix.replace(':', '_')}"
    raw = TRACES / f"{stem}.jsonl"
    raw.write_text("".join(json.dumps(op, ensure_ascii=False, separators=(",", ":")) + "\n" for op in ops))
    (TRACES / f"{stem}-oracle.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(f"{stem}: {len(ops)} operations, sha256={hashlib.sha256(raw.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
