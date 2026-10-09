#!/usr/bin/env python3
"""저장된 집계에서 한국어 A4 한 장용 HTML 원본 생성(브라우저 실행 없음)."""

from __future__ import annotations

import json
import statistics
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUMMARY = json.loads((HERE / "results" / "summary.json").read_text())
THROUGHPUT = json.loads((HERE / "results" / "throughput.json").read_text())

values = {(x["scale"], x["distribution"], x["mix"], x["backend"], x["kind"]): x
          for x in SUMMARY}
rates = defaultdict(list)
for item in THROUGHPUT:
    rates[(item["scale"], item["distribution"], item["mix"], item["backend"])].append(
        item["sequential_ops_per_second"])

conditions = [(1000, "uniform", "90:10"), (1000, "uniform", "50:50"),
              (10000, "uniform", "90:10"), (10000, "uniform", "50:50"),
              (10000, "skew", "90:10"), (10000, "skew", "50:50"),
              (30000, "uniform", "90:10"), (30000, "uniform", "50:50")]

rows = []
for scale, distribution, mix in conditions:
    label = f"{scale // 1000}k {'쏠림' if distribution == 'skew' else '균등'} {mix}"
    cells = []
    for kind in ("popular", "visualize", "register", "update"):
        mysql = values[(scale, distribution, mix, "mysql", kind)]
        neo = values[(scale, distribution, mix, "neo4j", kind)]
        cells.append(f"<td><span class='sql'>{mysql['p50_ms']:.2f}/{mysql['p95_ms']:.2f}</span>"
                     f"<br><span class='neo'>{neo['p50_ms']:.2f}/{neo['p95_ms']:.2f}</span></td>")
    mysql_rate = statistics.median(rates[(scale, distribution, mix, "mysql")])
    neo_rate = statistics.median(rates[(scale, distribution, mix, "neo4j")])
    rows.append(f"<tr><th>{label}</th>{''.join(cells)}"
                f"<td><span class='sql'>{mysql_rate:.0f}</span> / "
                f"<span class='neo'>{neo_rate:.0f}</span></td></tr>")

document = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>Vowser 실험 2 — 경로 운영 비교</title><style>
@page { size: A4; margin: 11mm 10mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #162433; font: 8.2pt/1.37 'Noto Sans CJK KR', UnDotum, sans-serif; }
.eyebrow { color: #33705d; font-size: 7.5pt; font-weight: 700; letter-spacing: .08em; }
h1 { font-size: 17.5pt; letter-spacing: -.04em; line-height: 1.15; margin: 2mm 0 2.3mm; }
.lead { background: #eaf4f0; border-left: 3px solid #2e8b72; padding: 2.2mm 3mm; margin: 0 0 2.5mm; font-size: 8.5pt; }
h2 { font-size: 9pt; margin: 3mm 0 1.2mm; color: #23485e; }
.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2.4mm 5mm; margin: 0 0 2.5mm; }
.meta p { margin: 0; }
table { width: 100%; border-collapse: collapse; font-size: 7.5pt; font-variant-numeric: tabular-nums; }
thead th { background: #e8eef2; color: #20465b; text-align: center; padding: 1.6mm .6mm; }
tbody th { text-align: left; white-space: nowrap; font-weight: 600; }
tbody td { text-align: center; white-space: nowrap; }
tbody th, tbody td { padding: 1.45mm .6mm; border-bottom: 1px solid #dce5e9; }
tbody tr:nth-child(even) { background: #f8fafb; }
.sql { color: #124c86; font-weight: 700; }
.neo { color: #9a4b29; font-weight: 700; }
.note { color: #526170; font-size: 7.2pt; margin: 1mm 0 0; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin: 3mm 0 0; }
.cards div { border-top: 1px solid #b8cbd1; padding-top: 1.5mm; }
.cards h2 { margin-top: 0; }
.cards p { margin: 0 0 1mm; }
.foot { border-top: 1px solid #d5dfe3; margin-top: 3mm; padding-top: 1.7mm; color: #4c5d69; font-size: 7.1pt; }
code { font: .95em monospace; }
</style></head><body>
<div class="eyebrow">VOWSER · 실제 경로 운영 투영 · 2026-09-29 UTC</div>
<h1>경로 등록·인기·가중치·시각화</h1>
<p class="lead"><strong>관찰:</strong> 고정한 8개 조건의 인기/시각화/등록/갱신에서 MySQL의 p50·p95가 모두 낮고, 순차 혼합 처리량도 8/8조건에서 높았다. Neo4j 속도 우위를 주장할 근거가 없다.</p>
<div class="meta">
<p><strong>범위</strong> 독립 선형 경로 1k·10k·30k, 깊이 5/10/20 edge; ROOT·STEP·HAS_STEP·NEXT_STEP. 10k 쏠림은 별도 진단.</p>
<p><strong>공정 조건</strong> DB별 1 CPU/3 GiB + Python worker 1 CPU/1 GiB, 단독 DB 기동·localhost·동일 trace/전체 반환, 3회 교차 라운드. DB bind 경로는 tmpfs.</p>
<p><strong>절차</strong> 블록마다 인증 준비→200 warmup→reset→200 timed→요청별 반환·경량 상태 검증→reset. 8조건 마지막 r2에서 전체 readback. 공식 48블록·9,600 timed, 실패 0.</p>
<p><strong>측정 범위</strong> 드라이버 왕복·결과 소비·commit 포함. 임베딩·LLM·API 전체, 동시 요청, 공유 STEP·분기 제외.</p>
</div>
<h2>모든 조건의 연산 지연</h2>
<table><thead><tr><th>최종 N·분포·읽기:쓰기</th><th>인기</th><th>시각화</th><th>등록</th><th>갱신</th><th>ops/s¹</th></tr></thead>
<tbody>""" + "\n".join(rows) + """</tbody></table>
<p class="note"><span class="sql">파란색 MySQL</span> / <span class="neo">갈색 Neo4j</span>. 지연은 p50/p95 ms; 각 종류는 조건별 30~270건. ¹ 200개 순차 mixed trace의 3라운드 처리량 중앙값이며 최대 QPS가 아님. 쏠림 조건은 별도 입력·읽기 분포.</p>
<div class="cards">
<div><h2>Neo4j 구현 진단</h2><p>1k·깊이 5/10/20의 18쓰기/방식: 원본형 독립 Cypher(깊이 d당 2d+3회)→단일 Cypher 배치의 p50은 등록 164.34→10.35 ms, 갱신 96.71→7.55 ms. 같은 Neo4j 내부 비교이며 MySQL 우위 결과에 합산하지 않음.</p></div>
<div><h2>정합과 한계</h2><p>48블록 경량 상태, 8조건 마지막 라운드의 ROOT/HAS/STEP/EDGE 전체 checksum 양쪽 일치. 20-edge 시각화의 null 경로도 원본 10-edge 제한대로 일치. SQL depth 메타데이터와 Neo 관계 탐색, 공유 호스트 부하 차이 존재. tmpfs 파일 사용량은 영구 디스크 성능 근거가 아니다. 30k 성공은 벡터 속성 제외 투영으로 검색 실험의 OOM과 다른 조건.</p></div>
</div>
<p class="foot">근거: <code>report.md</code> · <code>PROTOCOL.md</code> · <code>results/raw-*.csv</code> · <code>results/summary.json</code> · <code>results/per-round-metrics.json</code> · <code>results/audit.json</code> · <code>results/plans-*.json</code> · <code>../shared/environment-operations-end.json</code>. 중단 시도 200건은 별도 보존·공식 표에서 제외.</p>
</body></html>
"""
(HERE / "report.html").write_text(document)
print(f"wrote {HERE / 'report.html'}")
