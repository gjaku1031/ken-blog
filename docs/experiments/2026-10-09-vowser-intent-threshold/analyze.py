#!/usr/bin/env python3
"""PLAN.md에 고정한 분석을 그대로 계산함. 실행 전에 커밋해 두고 결과를 본 뒤 고치지 않음.

입력: raw/confirmatory.jsonl, raw/exploratory.jsonl, exploratory_reference.jsonl(2026-10-09 탐색적 평가의 원본 서버 1위 결과)
출력: results/summary.json, results/summary.md
"""

import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
THRESHOLDS = [0.0, 0.30, 0.35, 0.40, 0.43, 0.45, 0.50, 0.55, 0.60, 1.01]
ALPHA = 0.05
AUC_REJECT = 0.80


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def wilson(k: int, n: int, z: float = 1.959964) -> list[float]:
    if n == 0:
        return [0.0, 0.0]
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return [round(centre - half, 4), round(centre + half, 4)]


def mcnemar_exact(b: int, c: int) -> float:
    """짝지은 두 조건의 불일치 쌍(b, c)에 대한 양측 정확 이항 검정"""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return round(min(1.0, 2 * tail), 6)


def auc(pos: list[float], neg: list[float]) -> float:
    total = sum((p > q) + 0.5 * (p == q) for p in pos for q in neg)
    return total / (len(pos) * len(neg))


def chosen(record: dict, t: float) -> list[str]:
    return record["rank_ids"] if record["max_similarity"] >= t else record["rediscover_ids"]


def percentile(values: list[float], q: float) -> float:
    s = sorted(values)
    return round(s[min(len(s) - 1, math.ceil(q * len(s)) - 1)], 1)


def main() -> None:
    queries = {q["id"]: q for q in rows(HERE / "confirmatory_queries.jsonl")}
    raw = [r for r in rows(HERE / "raw" / "confirmatory.jsonl")]
    failures = [r["id"] for r in raw if not r["ok"]]
    ok = [r for r in raw if r["ok"]]
    ans = [r for r in ok if queries[r["id"]]["kind"] == "answerable"]
    n_ans = sum(1 for q in queries.values() if q["kind"] == "answerable")
    exp = lambda r: queries[r["id"]]["expected_id"]

    # H1: 같은 요청에서 두 분기의 1위 정답 비교
    rank_ok = {r["id"]: bool(r["rank_ids"]) and r["rank_ids"][0] == exp(r) for r in ans}
    red_ok = {r["id"]: bool(r["rediscover_ids"]) and r["rediscover_ids"][0] == exp(r) for r in ans}
    b = sum(rank_ok[i] and not red_ok[i] for i in rank_ok)
    c = sum(red_ok[i] and not rank_ok[i] for i in rank_ok)
    p1 = mcnemar_exact(b, c)
    h1 = {"rank_top1": sum(rank_ok.values()), "rediscover_top1": sum(red_ok.values()), "n": n_ans,
          "rank_only": b, "rediscover_only": c, "p_mcnemar": p1,
          "verdict": "지지" if b > c and p1 < ALPHA else "지지하지 못함"}

    # 임계값별 결과(실패한 요청은 오답으로 분모에 포함)
    sweep = []
    for t in THRESHOLDS:
        top1 = sum(1 for r in ans if chosen(r, t)[:1] == [exp(r)])
        top3 = sum(1 for r in ans if exp(r) in chosen(r, t)[:3])
        redis = sum(1 for r in ans if r["max_similarity"] < t)
        empty = sum(1 for r in ans if not chosen(r, t))
        amb = [r for r in ok if queries[r["id"]]["kind"] == "ambiguous"]
        amb_ok = sum(1 for r in amb if chosen(r, t)[:1] and chosen(r, t)[0] in queries[r["id"]]["acceptable_ids"])
        sweep.append({"t": t, "top1": top1, "top1_ci": wilson(top1, n_ans), "top3": top3, "top3_ci": wilson(top3, n_ans),
                      "rediscover_rate": round(redis / n_ans, 4), "empty": empty, "ambiguous_acceptable_top1": amb_ok})
    by_t = {s["t"]: s for s in sweep}

    # H2: 재검색을 끈 경우(t=0)가 0.43 이상이고, 0.60이 0.43 이하인가
    top1_at = lambda t: by_t[t]["top1"]
    z_ok = {r["id"]: chosen(r, 0.0)[:1] == [exp(r)] for r in ans}
    c_ok = {r["id"]: chosen(r, 0.43)[:1] == [exp(r)] for r in ans}
    b2 = sum(z_ok[i] and not c_ok[i] for i in z_ok)
    c2 = sum(c_ok[i] and not z_ok[i] for i in z_ok)
    h2 = {"top1_t0": top1_at(0.0), "top1_t043": top1_at(0.43), "top1_t060": top1_at(0.60),
          "t0_only": b2, "t043_only": c2, "p_mcnemar_t0_vs_t043": mcnemar_exact(b2, c2),
          "verdict": "지지" if top1_at(0.0) >= top1_at(0.43) and top1_at(0.60) <= top1_at(0.43) else "기각"}

    # H3: 최고 유사도로 미등록 요청을 가를 수 있는가(AUC)
    pos = [r["max_similarity"] for r in ans]
    neg = [r["max_similarity"] for r in ok if queries[r["id"]]["kind"] == "unanswerable"]
    a = auc(pos, neg)
    rng = random.Random(20261009)
    boots = sorted(auc([rng.choice(pos) for _ in pos], [rng.choice(neg) for _ in neg]) for _ in range(2000))
    h3 = {"auc": round(a, 4), "auc_bootstrap_95": [round(boots[49], 4), round(boots[1949], 4)],
          "n_answerable": len(pos), "n_unanswerable": len(neg),
          "unanswerable_max_similarity": sorted(round(x, 3) for x in neg),
          "verdict": "지지" if a < AUC_REJECT else "기각"}

    # 지연: 분석 단계 + 선택된 분기
    lat = {}
    for t in (0.0, 0.43, 1.01):
        vals = [r["analysis_ms"] + (r["rank_ms"] if r["max_similarity"] >= t else r["rediscover_ms"]) for r in ok]
        lat[str(t)] = {"median": percentile(vals, 0.5), "p95": percentile(vals, 0.95), "n": len(vals)}

    # 재현 점검: 탐색 자료를 같은 실행기로 돌린 0.43 결과가 탐색적 평가의 원본 서버 1위와 일치하는가
    check = None
    exp_raw = HERE / "raw" / "exploratory.jsonl"
    if exp_raw.exists():
        ref = {r["id"]: r["top1"] for r in rows(HERE / "exploratory_reference.jsonl")}
        mine = {r["id"]: (chosen(r, 0.43)[:1] or [None])[0] for r in rows(exp_raw) if r["ok"]}
        same = sum(1 for i in ref if mine.get(i) == ref[i])
        check = {"agree": same, "n": len(ref), "rate": round(same / len(ref), 4), "criterion": 0.90,
                 "passed": same / len(ref) >= 0.90}

    summary = {"failures": failures, "llm_fallback": sum(1 for r in ok if r["llm_fallback"]), "H1": h1, "H2": h2, "H3": h3,
               "sweep": sweep, "latency_ms": lat, "consistency_check": check}
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["| 임계값 | 1위 정답 | 3위 안 정답 | 재검색 비율 | 빈 결과 |", "| ---: | ---: | ---: | ---: | ---: |"]
    for s in sweep:
        lines.append(f"| {s['t']:.2f} | {s['top1']}/{n_ans} | {s['top3']}/{n_ans} | {s['rediscover_rate']:.0%} | {s['empty']} |")
    (out / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("failures", "llm_fallback", "H1", "H2", "H3", "latency_ms", "consistency_check")}, ensure_ascii=False, indent=1))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
