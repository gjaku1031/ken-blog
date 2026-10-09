#!/usr/bin/env python3
"""원시 JSONL을 조건별 CSV·상세 Markdown·1면 PDF로 보존한다."""

from __future__ import annotations

import argparse
from collections import defaultdict
import csv
import json
import math
from pathlib import Path
import statistics

from search.freeze import sha256


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ranked = sorted(values)
    position = (len(ranked) - 1) * fraction
    lower, upper = math.floor(position), math.ceil(position)
    return ranked[lower] + (ranked[upper] - ranked[lower]) * (position - lower)


def wilson(successes: int, total: int) -> tuple[float | None, float | None]:
    if total == 0:
        return None, None
    z = 1.959963984540054
    p = successes / total
    denominator = 1 + z*z/total
    center = (p + z*z/(2*total)) / denominator
    half = z * math.sqrt((p*(1-p) + z*z/(4*total))/total) / denominator
    return center-half, center+half


def pdf_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def write_one_page_pdf(path: Path, lines: list[str]) -> None:
    """표준 PDF 1.4/Helvetica 단일 페이지. ASCII 요약만 배치한다."""
    if len(lines) > 48:
        raise RuntimeError("PDF has more than one-page line budget")
    stream = ["BT /F1 8 Tf 28 550 Td 10.5 TL"]
    for index, line in enumerate(lines):
        if index:
            stream.append("T*")
        stream.append(f"({pdf_escape(line)}) Tj")
    stream.append("ET")
    content = ("\n".join(stream) + "\n").encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(content)} >>\nstream\n".encode("ascii") + content + b"endstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(f"{i} 0 obj\n".encode("ascii") + obj + b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(f"trailer\n<< /Root 1 0 R /Size {len(objects)+1} >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
    path.write_bytes(output)


def summarize(inputs: list[Path]) -> tuple[list[dict], list[dict], dict]:
    groups = defaultdict(list)
    probes = {}
    warmups = {}
    sources = {}
    errors = []
    for path in inputs:
        header = None
        sources[str(path)] = sha256(path)
        for line in path.read_text(encoding="utf-8").splitlines():
            item = json.loads(line)
            kind = item["kind"]
            if kind == "header":
                header = item
                continue
            if header is None:
                raise RuntimeError(f"missing header: {path}")
            key = (header["backend"], header["distribution"], header["n"], item["condition"])
            if kind == "sample":
                groups[(key, item["arm"])].append(item)
                if not item["ok"]:
                    errors.append({"source": str(path), "condition": key, "record": item})
            elif kind == "quality_probe":
                probes[(key, item["arm"])] = item
            elif kind == "warmup":
                item["round_index"] = header["round_index"]
                warmups.setdefault(key, []).append(item)
    rows = []
    for (key, arm), samples in sorted(groups.items()):
        backend, distribution, n, condition = key
        if len(samples) != 600 or len({(s["query_id"], s["round"]) for s in samples}) != 600:
            raise RuntimeError(f"incomplete or duplicate sample denominator: {key} {arm} {len(samples)}")
        valid = [s for s in samples if s["ok"]]
        first_round = [s for s in samples if s["round"] == 0]
        answerable = [s for s in first_round if s["answerable"]]
        empty = [s for s in first_round if not s["answerable"]]
        exact = sum(bool(s.get("exact_order")) for s in answerable)
        top1 = sum(bool(s.get("path_ids") and s["path_ids"][0] == s["target_ids"][0]) for s in answerable)
        ci_low, ci_high = wilson(exact, len(answerable))
        probe = probes.get((key, arm), {})
        all_warm = [x for block in warmups[key] for x in block["records"] if x["arm"] == arm]
        warm = [x["elapsed_ms"] for x in all_warm if x["ok"]]
        warm_blocks = []
        for block in warmups[key]:
            own = [x["elapsed_ms"] for x in block["records"] if x["arm"] == arm and x["ok"]]
            warm_blocks.append({"round": block["round_index"], "first50_p50_ms": percentile(own[:50], .50),
                                "last50_p50_ms": percentile(own[-50:], .50),
                                "failures": sum(not x["ok"] for x in block["records"] if x["arm"] == arm)})
        row = {"backend": backend, "distribution": distribution, "n_paths": n,
               "condition": condition, "arm": arm, "requests": len(samples),
               "success_requests": len(valid), "failure_requests": len(samples)-len(valid),
               "answerable_unique_queries": len(answerable), "empty_unique_queries": len(empty),
               "top1_count": top1, "exact_order_count": exact,
               "exact_order_wilson95_low": ci_low, "exact_order_wilson95_high": ci_high,
               "mean_effective_recall": statistics.mean(s.get("effective_recall", 0) or 0 for s in answerable) if answerable else None,
               "empty_correct_count": sum(bool(s.get("empty_correct")) for s in empty),
               "candidate_method": probe.get("method"),
               "candidate_recall_at3": probe.get("mean_candidate_recall_at3"),
               "p50_ms": percentile([s["elapsed_ms"] for s in valid], .50),
               "p95_ms": percentile([s["elapsed_ms"] for s in valid], .95),
               "mean_db_roundtrips": statistics.mean(s["db_roundtrips"] for s in valid) if valid else None,
               "mean_db_return_estimated_bytes": statistics.mean(s["db_return_estimated_bytes"] for s in valid) if valid else None,
               "mean_json_bytes": statistics.mean(s["json_bytes"] for s in valid) if valid else None,
               "max_rss_bytes": max(s["rss_bytes"] for s in samples),
               "warmup_first50_p50_ms": percentile(warm[:50], .50),
               "warmup_last50_p50_ms": percentile(warm[-50:], .50),
               "warmup_blocks": warm_blocks,
               "warmup_requests": len(all_warm),
               "warmup_failures": sum(not x["ok"] for x in all_warm)}
        rows.append(row)
    phase_rows = []
    for (key, arm), samples in sorted(groups.items()):
        backend, distribution, n, condition = key
        phases = defaultdict(list)
        for sample in samples:
            if sample["ok"]:
                for phase, elapsed in sample["phases_ms"].items():
                    phases[phase].append(elapsed)
        for phase, values in phases.items():
            phase_rows.append({"backend": backend, "distribution": distribution, "n_paths": n,
                               "condition": condition, "arm": arm, "phase": phase,
                               "count": len(values), "p50_ms": percentile(values, .50),
                               "p95_ms": percentile(values, .95)})
    return rows, errors, {"input_sha256": sources, "group_count": len(groups), "phase_rows": phase_rows}


def make_md(rows: list[dict], errors: list[dict], provenance: dict) -> str:
    text = ["# 실험 1 검색 비교 결과", "",
            "고정 합성 1536차원 벡터의 의도 후보 검색부터 전체 경로 반환까지의 어댑터 측정. 한국어 의미 검색, 원본 OpenAI 모델, LLM, STT 또는 전체 Vowser 요청 지연 결과가 아님.", "",
            "각 행 200개의 서로 다른 test 질의를 3회 반복. 지연 p50/p95는 성공 요청 기준, 실패는 600회 전체 분모에 별도 기록. 정합·recall은 첫 회차의 서로 다른 질의 기준. 정답 없는 질의는 recall 분모에서 빼고 무응답 정합으로 분리. 정확 순서의 Wilson 95% 구간은 200개 중 답 있는 질의의 이항 비율 기준이며 생성 질의 모집단에만 적용.", "",
            "|분포|경로|조건|군|p50 ms|p95 ms|Top1|정확순서/답있음|평균 recall|후보 recall@3|무응답|실패/600|왕복|RSS MiB|",
            "|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for row in rows:
        val = lambda x: "—" if x is None else f"{x:.3f}"
        text.append(f"|{row['distribution']}|{row['n_paths']}|{row['condition']}|{row['arm']}|{val(row['p50_ms'])}|{val(row['p95_ms'])}|{row['top1_count']}/{row['answerable_unique_queries']}|{row['exact_order_count']}/{row['answerable_unique_queries']}|{val(row['mean_effective_recall'])}|{val(row['candidate_recall_at3'])}|{row['empty_correct_count']}/{row['empty_unique_queries']}|{row['failure_requests']}/600|{val(row['mean_db_roundtrips'])}|{row['max_rss_bytes']/1048576:.1f}|")
    text += ["", "후보 recall이 0.95 미만이거나 반환 경로 정합이 실패한 조건의 지연 우위를 동일 품질 성능으로 해석하지 않음. `neo_original`은 원본 알고리즘 재현 어댑터로, 원본 서비스 함수 자체를 호출한 측정이 아님. 힌트 있는 `neo_optimized`의 후보 방법은 ANN이 아닌 도메인 관계 exact scan.", "",
             "## 실패 및 원자료", "", f"- 전체 실패 요청: {len(errors)}", "- 원시 JSONL SHA-256:"]
    for path, digest in provenance["input_sha256"].items():
        text.append(f"  - `{path}`: `{digest}`")
    text += ["", "단계별 지연은 `phases.csv`, 라운드별 첫/마지막 50회 warmup p50은 `summary.json`의 `warmup_blocks`에 보존. 반환 추정 바이트·raw score·payload SHA-256·질의 ID·반복 ID·에러는 원시 JSONL에 보존. PDF는 top3 중심의 한 장 요약."]
    return "\n".join(text) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", nargs="+", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        raise RuntimeError("report output directory already contains files")
    args.output.mkdir(parents=True, exist_ok=True)
    rows, errors, provenance = summarize(args.inputs)
    if not rows:
        raise RuntimeError("no complete measurement rows")
    with (args.output / "conditions.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with (args.output / "phases.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(provenance["phase_rows"][0]))
        writer.writeheader()
        writer.writerows(provenance["phase_rows"])
    (args.output / "summary.json").write_text(json.dumps({"rows": rows, "errors": errors,
                                                             "provenance": provenance}, indent=2,
                                                            ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    (args.output / "RESULTS.md").write_text(make_md(rows, errors, provenance), encoding="utf-8")
    lines = ["Vowser experiment 1: synthetic vector-to-full-path search", "1536-d fixed synthetic vectors. Search-only adapters; NOT Korean/LLM/STT/E2E quality.",
             "Dist  Paths  Hint  Arm             p50ms  p95ms  Top1    Recall3  Empty  Fail/600  RTT  RSSMiB"]
    for row in rows:
        if not row["condition"].endswith("top3"):
            continue
        arm = {"neo_original": "Neo original", "neo_optimized": "Neo optimized", "mysql_faiss": "MySQL+FAISS"}[row["arm"]]
        lines.append(f"{row['distribution'][:1].upper():<4} {row['n_paths']:>6}  {('Y' if row['condition'].startswith('hint') else 'N'):>4}  {arm:<14}  {row['p50_ms'] or 0:>6.1f}  {row['p95_ms'] or 0:>6.1f}  {row['top1_count']:>3}/{row['answerable_unique_queries']:<3}  {(row['mean_effective_recall'] or 0):>7.3f}  {row['empty_correct_count']:>2}/{row['empty_unique_queries']:<2}  {row['failure_requests']:>3}/600  {(row['mean_db_roundtrips'] or 0):>3.1f}  {row['max_rss_bytes']/1048576:>6.1f}")
    lines += ["p50/p95 use successful requests; failures retained in denominator. Recall excludes empty gold.",
              "Neo optimized with hint uses exact domain scan; candidate recall is not ANN there.",
              "Any candidate recall <.95, payload mismatch, or failure forbids equal-quality speed claim."]
    write_one_page_pdf(args.output / "ONE_PAGE.pdf", lines)
    print(json.dumps({"status": "reported", "groups": len(rows), "failures": len(errors),
                      "output": str(args.output)}, sort_keys=True))


if __name__ == "__main__":
    main()
