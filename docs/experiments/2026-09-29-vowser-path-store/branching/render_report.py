"""보존된 원시 측정 요약으로 한국어 MD·A4 한 장 HTML 생성."""

from __future__ import annotations

import json
from html import escape
from pathlib import Path

from branching.model import CELLS, STRESS_CELLS, cell_id

HERE = Path(__file__).resolve().parent
RESULTS = HERE/'results'
MODES = ('neo_adj','mysql_adj','neo_member','mysql_member')
MODE_LABELS = ('Neo 탐색','MySQL CTE','Neo 소속','MySQL 소속')


def metric(record: dict | None, mode: str, html: bool = False) -> str:
    if not record:
        return '미완료'
    row = record['mode'][mode]
    p50,p95 = row['p50_ms_correct'],row['p95_ms_correct']
    if p50 is None:
        return f"— ({row['correct']}/{row['attempts']})"
    if html:
        return f"{p50:.2f}<small> / {p95:.2f}</small><br><em>{row['correct']}/{row['attempts']}</em>"
    return f"{p50:.2f}/{p95:.2f} ({row['correct']}/{row['attempts']})"


def row_for(cell: str, record: dict | None, stress: bool) -> tuple[str,str]:
    parts = cell.split('-')
    n = int(parts[0][1:])
    if stress:
        depth = int(parts[1][1:])
        share = int(parts[2][1:])
        cap = int(parts[3][1:])
        label = f"{n:,} / {depth}"
    else:
        share = int(parts[1][1:])
        cap = int(parts[2][1:])
        label = f"{n:,} / 5·10·20"
    if record and not record['complete']:
        label += ' (부분)'
    actual = f"{record['model_stats']['actual_shared_percent']:.1f}" if record else '—'
    md = f"| {label} | {share}% | {cap} | {actual}% | " + ' | '.join(metric(record,m) for m in MODES) + ' |'
    html = '<tr>' + ''.join(f'<td>{escape(v)}</td>' for v in (label,f'{share}%',str(cap),f'{actual}%'))
    html += ''.join(f'<td>{metric(record,m,True)}</td>' for m in MODES) + '</tr>'
    return md,html


def main() -> None:
    data = json.loads((RESULTS/'analysis.json').read_text())
    cells = data['cells']
    main_ids = [cell_id(*args) for args in CELLS]
    stress_ids = [cell_id(total,share,cap,depth) for total,depth,share,cap in STRESS_CELLS]
    main_complete = sum(cells.get(c,{}).get('complete',False) for c in main_ids)
    stress_complete = sum(cells.get(c,{}).get('complete',False) for c in stress_ids)
    observed = [cells[c] for c in main_ids+stress_ids if c in cells]
    measured_attempts = sum(r['measured_rows'] for r in observed)
    measured_correct = sum(sum(r['mode'][m]['correct'] for m in MODES) for r in observed)
    main_rows = [row_for(c,cells.get(c),False) for c in main_ids]
    stress_rows = [row_for(c,cells.get(c),True) for c in stress_ids]
    scenario = {}
    representative = cells.get('n10000-s50-b4') or cells.get('n1000-s50-b4')
    if representative:
        for mode in MODES:
            scenario[mode] = {name:representative['scenario'][mode][name] for name in
                              representative['scenario'][mode]}
    case_sentence = ''
    if representative:
        c = representative['cell']
        case_sentence = (f"대표 {c}: Neo 탐색 {metric(representative,'neo_adj')}, "
                         f"MySQL CTE {metric(representative,'mysql_adj')}, "
                         f"Neo 소속 {metric(representative,'neo_member')}, "
                         f"MySQL 소속 {metric(representative,'mysql_member')}. ")
    md = f"""# Vowser 공유 STEP·분기 대체 경로: 현재 제품에 없는 확장 프로토타입

2026-09-29 UTC. 현재 제품의 구현·2025년 성과가 아닌 별도 DB 프로토타입. 기본 {main_complete}/16셀, 한계 {stress_complete}/4셀 완료. 보존된 본측정 {measured_correct:,}/{measured_attempts:,}건의 전체 반환값이 독립 원장과 일치. 미완료 셀은 성공률 분모에 넣어 완주처럼 서술하지 않음.

## 핵심 결과

{case_sentence}아래 지연은 root 조회부터 전체 경로 필드의 canonical JSON 생성까지의 단일 클라이언트 왕복. p50/p95는 **정답 응답**에서만 계산하고 괄호는 정답/전체 시도. timeout·오답·오류는 전체 시도 분모에 남김. 따라서 정합이 다른 두 군의 p50만 비교해 성능 우위를 주장할 수 없음.

## 기본 16셀

규모는 한 셀의 **전체 등록 경로 수**. 연결 수 5/10/20이 셀 안에 균등. 실제 공유율은 재사용된 path-STEP 소속 건수 / 전체 소속 건수. 아래 단위 ms는 p50/p95.

| 경로 수 / 연결 | 목표 공유 | 분기 상한 | 실제 공유 | Neo 탐색 | MySQL CTE | Neo 소속 | MySQL 소속 |
|---|---:|---:|---:|---:|---:|---:|---:|
""" + '\n'.join(x[0] for x in main_rows) + f"""

## 별도 50/100연결 한계 탐색

원본 제품 최대 20연결 밖. 기본 결과와 합산하지 않음.

| 경로 수 / 연결 | 목표 공유 | 분기 상한 | 실제 공유 | Neo 탐색 | MySQL CTE | Neo 소속 | MySQL 소속 |
|---|---:|---:|---:|---:|---:|---:|---:|
""" + '\n'.join(x[0] for x in stress_rows) + """

## 설계·정합·해석

- `PROTOCOL.md`의 seed 20260929·16+4 matrix. 30도메인, 공유 생성기의 path ID와 5/10/20연결. 이 프로토타입에서만 96 의도를 4 task family로 투영하고 별도 auth 상태를 부여. 물리적으로 60개 domain/intent/auth 문맥. 공유 STEP payload는 canonical URL/selector/action으로 통일. 현재 제품의 sessionId STEP ID를 공유 기능으로 오인하지 않음.
- MySQL adjacency 재귀 CTE와 Neo4j `NEXT` 가변 길이 탐색은 문맥 root 전체에서 STEP 차단을 확장 중 검사하고 완주 경로를 top3로 선택. 두 membership 군은 등록 경로 소속으로 차단을 검사하는 강한 기준선. 네 군 모두 경로 ID·순서를 지키며 동일 필드·동일 JSON을 반환.
- 각 셀의 매 round·DB 재기동 블록마다 각 모드 200 warmup 후 200질의 본측정. 기본 총 warmup 38,400·측정 38,400, 한계 별도 9,600·9,600. 요청당 DB 2초 제한, round별 MySQL↔Neo4j 기동 순서와 DB 내 모드 순서 교차. 160 정상 대체 사례는 목표 깊이 5/10/20을 54/53/53으로 층화; `none` 20, 인증 차단20. 같은 규모에서 문맥/source 경로 선택을 짝지음. 50/100 연결은 고정 깊이.
- 깊이10/20 사례는 더 짧은 경로의 고유 STEP도 차단하므로 입력 blocker 수와 반환 데이터 길이가 함께 증가. 깊이만의 순수 효과로 해석 불가. 10k 공유0%·상한2/4 조합은 생략했으므로 그 상호작용도 판단 불가. 공유0%에서 상한2/4는 실제 분기1일 수 있음.
- Neo4j Community 5.26.19 / Python driver 5.28.2, MySQL 8.4.11 / PyMySQL 1.1.2. 각 DB 1 CPU/3 GiB와 별도 Python worker 1 CPU/1 GiB. localhost DB 전용, 운영 서비스·브라우저·자연어/LLM/음성 지연은 포함하지 않음. MySQL/Neo 서비스 구조 및 물리 파일 크기에서 운영비 절감률 추론 금지.

## 재현·원시 자료

`shared/setup.sh`와 `shared/run-client.sh`가 전용 환경, `branching/run.sh`가 호스트 원본 HEAD/SHA 검사와 worker 실행. 실험 1→2→3 lease 후 `bash branching/run.sh measure` 다음 `bash branching/run.sh measure-stress`; `python -m branching.summarize`·`python -m branching.render_report`로 원시 CSV에서 집계/문서 재생성. `results/{cell}/input.json`(고정 질의·oracle SHA), `expected.jsonl`(전체 정답), `load-verification.json`(전 membership/payload), `plans.json`(EXPLAIN/PROFILE), `raw.csv`(warmup·본측정 개별 결과), `summary.json`과 `results/analysis.json` 보존. 이전 720경로 스모크 자료는 본측정과 분리. 원본 제품 코드는 변경하지 않음.
"""
    (HERE/'report.md').write_text(md)

    html = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Vowser 분기 경로 프로토타입</title>
<style>@page{{size:A4;margin:10mm}}*{{box-sizing:border-box}}body{{font-family:'Noto Sans CJK KR',sans-serif;color:#1c2833;font-size:8.1pt;line-height:1.36;margin:0}}.eyebrow{{color:#007d78;font-weight:700;font-size:8pt;letter-spacing:.06em}}h1{{font-size:18pt;margin:1mm 0 2mm;line-height:1.18}}h2{{font-size:9.5pt;margin:3.7mm 0 1.2mm;color:#21435a}}p{{margin:0 0 2mm}}.lead{{font-size:8.6pt;color:#4f6271}}.callout{{background:#e9f5f3;border-left:3px solid #168f83;padding:2.3mm 3mm;margin:3mm 0}}table{{width:100%;border-collapse:collapse;font-size:6.7pt;line-height:1.18}}th{{background:#eaf0f4;color:#24445a;text-align:right;padding:1.5mm 1mm;border-bottom:1px solid #aebec9}}th:first-child,td:first-child{{text-align:left}}td{{text-align:right;padding:1.35mm 1mm;border-bottom:1px solid #e0e6eb}}tr:nth-child(even){{background:#f8fafb}}small{{color:#758594;font-size:6pt}}em{{font-style:normal;color:#277c74;font-size:5.9pt}}.note{{color:#5c6c7a;font-size:7pt}}.grid{{display:grid;grid-template-columns:1fr 1fr;gap:4mm}}.grid p{{font-size:7.5pt}}footer{{border-top:1px solid #c6d2da;margin-top:3mm;padding-top:2mm;font-size:6.8pt;color:#5d6e7b}}</style></head><body>
<div class="eyebrow">VOWSER · 2026-09-29 · 별도 확장 실험</div><h1>공유 STEP·분기 대체 경로</h1><p class="lead">현재 제품에 없는 기능의 Neo4j·MySQL 프로토타입. 동일 문맥에서 차단 STEP을 피해 등록 경로 top3 전체를 반환.</p>
<div class="callout"><b>관찰</b> 기본 {main_complete}/16셀·한계 {stress_complete}/4셀 완료, 본측정 반환 정합 {measured_correct:,}/{measured_attempts:,}. {escape(case_sentence)}</div>
<h2>기본 조건 · 연결 5/10/20 균등</h2><table><thead><tr><th>전체 경로 / 연결</th><th>목표 공유</th><th>분기 상한</th><th>실제 공유</th><th>Neo 탐색</th><th>MySQL CTE</th><th>Neo 소속</th><th>MySQL 소속</th></tr></thead><tbody>{''.join(x[1] for x in main_rows)}</tbody></table>
<p class="note">ms: p50 / p95(정답 응답), 아래 수: 정답/전체 시도. 실패·timeout도 전체 시도 분모 유지.</p>
<h2>별도 한계 · 제품 상한 20연결 밖</h2><table><thead><tr><th>전체 경로 / 연결</th><th>목표 공유</th><th>분기 상한</th><th>실제 공유</th><th>Neo 탐색</th><th>MySQL CTE</th><th>Neo 소속</th><th>MySQL 소속</th></tr></thead><tbody>{''.join(x[1] for x in stress_rows)}</tbody></table>
<div class="grid"><div><h2>정합·측정</h2><p>등록 경로 원장과 두 DB의 전체 STEP payload 대조. 매 DB 재기동/round마다 200 warmup 후 200질의×2모드. root 조회부터 전체 반환 JSON까지의 단일 요청 시간. 탐색군은 차단 STEP을 확장 중 검사하고 완주 뒤 top3 선정.</p></div><div><h2>범위</h2><p>한 번에 DB 하나만 켜고 1 CPU/3 GiB + worker 1 CPU/1 GiB. MySQL 8.4.11, Neo4j 5.26.19. 합성 경로·30도메인·별도 intent/auth 투영. 브라우저·LLM·음성·운영 발급·결제 없음. 깊은 사례는 blocker 수도 증가해 깊이만의 효과는 아님.</p></div></div>
<footer>원시 자료·실행 계획·쿼리·환경·SHA·재현 절차: <code>PROTOCOL.md</code> · <code>results/</code> · <code>report.md</code>. 현재 Vowser 제품 기능·2025년 구현 성과로 해석 금지.</footer></body></html>"""
    (HERE/'report.html').write_text(html)
    print(f'report generated: main {main_complete}/16, stress {stress_complete}/4')


if __name__=='__main__':
    main()
