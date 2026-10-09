"""검증된 교정 코호트 요약에서 한국어 보고서와 인쇄용 HTML 생성."""

from __future__ import annotations

import json
from html import escape
from pathlib import Path

from manifest import HERE, RESULTS, sha
from rawcheck import MODES

LABEL = {'neo_adj':'Neo 탐색','mysql_adj':'MySQL CTE',
         'neo_member':'Neo 소속','mysql_member_ordered':'MySQL 소속(순서 고정)'}


def ratio(row: dict) -> str:
    return f"{row['correct']:,}/{row['attempts']:,}"


def latency(row: dict) -> str:
    return '—' if row['p50_ms_correct'] is None else (
        f"{row['p50_ms_correct']:.2f} / {row['p95_ms_correct']:.2f}")


def mode_table(group: dict) -> tuple[str,str]:
    lines = ['| 군 | 정답/본측정 | timeout | 오답 | 기타 오류 | 정답 p50/p95 ms | warmup 실패/전체 |',
             '|---|---:|---:|---:|---:|---:|---:|']
    html = ['<table><thead><tr><th>군</th><th>정답/측정</th><th>timeout</th><th>오답</th><th>기타</th><th>정답 p50/p95 ms</th><th>warmup 실패</th></tr></thead><tbody>']
    for mode in MODES:
        row = group['mode']['measure'][mode]
        warmup = group['mode']['warmup'][mode]
        failure = warmup['attempts']-warmup['correct']
        values = [LABEL[mode],ratio(row),str(row['timeouts']),
                  str(row['wrong_results']),str(row['other_errors']),latency(row),
                  f"{failure}/{warmup['attempts']}"]
        lines.append('| '+' | '.join(values)+' |')
        html.append('<tr>'+''.join(f'<td>{escape(value)}</td>' for value in values)+'</tr>')
    html.append('</tbody></table>')
    return '\n'.join(lines),''.join(html)


def cell_table(data: dict, names: list[str]) -> tuple[str,str]:
    lines = ['| 셀 | 실제 공유 | 실제 최대 분기 | Neo 탐색 | MySQL CTE | Neo 소속 | MySQL 순서 고정 소속 |',
             '|---|---:|---:|---:|---:|---:|---:|']
    html = ['<table class="cells"><thead><tr><th>셀</th><th>공유</th><th>분기</th><th>Neo 탐색</th><th>MySQL CTE</th><th>Neo 소속</th><th>MySQL 소속</th></tr></thead><tbody>']
    for name in names:
        record = data['cells'][name]
        values = [name,f"{record['stats']['actual_shared_percent']:.1f}%",
                  str(record['stats']['max_outdegree'])]
        values.extend(latency(record['measured'][mode]) for mode in MODES)
        lines.append('| '+' | '.join(values)+' |')
        html.append('<tr>'+''.join(f'<td>{escape(value)}</td>' for value in values)+'</tr>')
    html.append('</tbody></table>')
    return '\n'.join(lines),''.join(html)


def depth_table(group: dict) -> str:
    lines = ['| 목표 깊이 | Neo 탐색 | MySQL CTE | Neo 소속 | MySQL 순서 고정 소속 |',
             '|---:|---:|---:|---:|---:|']
    for depth in ('5','10','20'):
        values = [depth]+[latency(group['target_depth'][mode][depth]) for mode in MODES]
        lines.append('| '+' | '.join(values)+' |')
    return '\n'.join(lines)


def main() -> None:
    data = json.loads((RESULTS/'analysis.json').read_text())
    main_group,stress_group = data['groups']['main'],data['groups']['stress']
    if (main_group['cell_count'],stress_group['cell_count']) != (16,4):
        raise AssertionError('20-cell cohort not complete')
    main_modes,main_modes_html = mode_table(main_group)
    stress_modes,stress_modes_html = mode_table(stress_group)
    main_cells,main_cells_html = cell_table(data,main_group['cells'])
    stress_cells,stress_cells_html = cell_table(data,stress_group['cells'])
    main_correct = sum(main_group['mode']['measure'][m]['correct'] for m in MODES)
    stress_correct = sum(stress_group['mode']['measure'][m]['correct'] for m in MODES)
    main_total = sum(main_group['mode']['measure'][m]['attempts'] for m in MODES)
    stress_total = sum(stress_group['mode']['measure'][m]['attempts'] for m in MODES)
    main_attempts = data['attempts']['main']
    stress_attempts = data['attempts']['stress']
    attempts_md = '\n'.join(f"- `{item['file']}`: {item['state']}, 완료 {item['completed_cells']}셀, "
        f"기존 완료 skip {item['skipped_completed_cells']}셀, 부분 셀 {item['partial_cell'] or '없음'}, "
        f"상태 SHA `{item['sha256']}`." for item in main_attempts+stress_attempts)
    zero = [data['cells'][f'n1000-s0-b{cap}']['stats'] for cap in (1,2,4)]
    topology = {tuple(stats[key] for key in ('unique_steps','unique_next_pairs','max_outdegree')) for stats in zero}
    if len(topology)!=1:
        raise AssertionError('zero-share topology assumption changed')
    zero_steps,zero_edges,zero_degree = next(iter(topology))
    md = f"""# Vowser에 아직 없는 공유 STEP·분기 대체 경로: 교정 DB 프로토타입 결과

2026-09-29 UTC. **이 기능은 현재 Vowser 제품에 구현되지 않았다.** 새 `branching-revised` 코호트의 기본 16셀과 제품 상한 20연결을 넘는 별도 한계 4셀을 모두 완료했다. 본측정 정답은 기본 **{main_correct:,}/{main_total:,}**, 한계 **{stress_correct:,}/{stress_total:,}**이다. 두 군의 성공률·지연을 합산해 한 조건처럼 해석하지 않는다.

현재 조건에서 Neo4j의 **전반적 속도 우위는 확인되지 않았다**. 같은 셀 `n1000-s50-b2/b4`에서는 Neo 소속군의 p50이 MySQL 순서 고정 소속군보다 낮았지만, p95까지 일관되게 낮지는 않다. 경로 탐색·소속 방식은 각 DB에서 가능한 대안 구현으로 놓고 조건별 정합·지연을 함께 판단해야 한다.

## 기본 16셀: 1천·1만 전체 등록 경로, 깊이 5/10/20 균등

{main_modes}

이 군별 p50/p95는 규모·공유율·분기상한이 서로 다른 16셀의 정답 응답을 합친 **pooled 분포**다. 특정 한 조건의 대표 지연이 아니다. warmup 실패는 전부 Neo4j `TransactionTimedOutClientConfiguration`의 2초 timeout이며 본측정 분모에 섞지 않았다. [원문 예시](results/n1000-s0-b1/raw-neo4j-r0.csv).

각 셀의 정답 응답 p50/p95(ms). 성공/전체 요청 및 timeout은 위 군별 표와 [`results/analysis.json`](results/analysis.json)에 보존.

{main_cells}

정상 대체경로 160질의/셀의 목표 깊이별 정답 응답 p50/p95(ms)는 다음과 같다. 각 깊이 값 역시 여러 규모·공유·분기 셀을 합친 pooled 분포다. 깊은 목표는 짧은 경로를 막기 위한 STEP 수도 늘어나므로 깊이만의 독립 효과로 해석할 수 없다.

{depth_table(main_group)}

## 별도 한계 4셀: 1천 경로, 깊이 50/100 고정

원본 제품의 20연결 상한 밖 조건이다. 기본 16셀의 성능·정합 분모와 합치지 않는다.

{stress_modes}

이 p50/p95도 깊이50/100·공유0/50% 네 셀을 합친 pooled 분포다. warmup 실패 24건은 모두 Neo4j의 2초 timeout이며 본측정 실패는 아니다.

{stress_cells}

## 비교의 의미와 한계

동일 seed 20260929·20셀 입력·전체 expected JSONL을 먼저 SHA로 동결했고, 원래 실행에 존재한 10셀 입력은 byte 단위로 일치했다. 같은 도메인·의도·인증 문맥에서 막힌 STEP이 없는 **완주 등록 경로**를 연결 수/path ID 순서로 top3 반환한다. Neo `NEXT` 가변 길이 탐색과 MySQL 재귀 CTE는 실제 adjacency를 확장한다. 두 소속군은 경로 membership으로 차단을 검사한다. 각 셀의 전체 membership과 반환 대상 STEP 필드(URL·action·selector·description)를 생성 원장과 양쪽 DB에서 대조했다. 저장된 `kind`는 이 반환 필드 전량 대조에는 포함되지 않았다. 작은 스모크는 기본 840사례×4군=3,360, 깊이100 200사례×4군=800 요청 모두 정답이었다.

MySQL 소속 비교군의 **바깥 SELECT 한 곳에만 `STRAIGHT_JOIN`**을 넣어 `e→m→s` 조인 순서를 고정했다. 원래 코호트에서 `br3_member` 선행 스캔을 발견한 뒤 결정한 **사후 설계 변경**이므로, 원래 9셀·부분 시도와 새 결과를 이어 붙이거나 전후 개선율로 주장하지 않는다. 두 코호트와 중단 이유는 [`branching/results/analyst-stop-evidence.json`](../branching/results/analyst-stop-evidence.json)에 보존. ordered SQL을 역치환하면 원본 SQL과 byte 단위로 같고, 새 각 셀 EXPLAIN 원문 및 대표 답3경로 `e→m→s` guard를 보존했다.

각 DB는 1 CPU/3 GiB, Python worker는 1 CPU/1 GiB이며 한 번에 DB 하나만 켰다. 매 재시작 뒤 인증 질의와 모드별 200 warmup을 거친 다음 200 본측정 질의를 수행했다. 요청당 DB 제한은 2초. 지연은 root 찾기부터 **전체 반환 필드의 canonical JSON 생성까지**이며 정답 응답에서만 p50/p95를 산출했다. timeout·오답·기타 오류는 본측정 전체 시도 분모에 남겼다. warmup 실패는 별도 열이다. `complete`는 모든 행이 발행·보존됐다는 뜻이며 전부 정답이라는 뜻이 아니다.

공유율은 재사용된 path-STEP 소속 건수/전체 소속 건수이고, 분기상한과 실제 outdegree는 다르다. 공유0%의 1천 경로 세 셀은 상한 1/2/4에도 실제 고유 STEP {zero_steps:,}, 물리 연결 {zero_edges:,}, 최대 outdegree {zero_degree}로 같은 구조다. 1만 경로 공유0% 상한2/4는 매트릭스에서 제외해 그 상호작용을 알 수 없다. 자료는 전용 DB를 쓰지만 물리 저장소가 [`tmpfs`](../operations/results/storage-medium.json)이고 같은 VM에 다른 서비스가 존재한다. 영구 SSD 운영 지연·비용, 제품 API·브라우저·LLM·음성·실인증/결제까지 외삽할 수 없다.

## 원시자료와 재현

- 동결: [`results/freeze.json`](results/freeze.json) SHA `{data['freeze_sha256']}`, [`results/input-freeze.json`](results/input-freeze.json) SHA `{data['input_freeze_sha256']}`. 제품 소스·원래 실행 9파일·shared generator/client·20셀 입력 SHA 기록.
- 셀마다 `input.json`, `expected.jsonl`, `load-*.json`, `plans-*.json`, 각 round의 `raw-*.csv`·`block-*.json`, 검증한 합본 `raw.csv`·`summary.json` 보존. [`results/postrun-db-evidence.json`](results/postrun-db-evidence.json)에 종료 후 양 DB의 객체 수·인덱스·버전·자원·정지 상태 보존. [`results/analysis.json`](results/analysis.json)은 완주 셀만 다시 읽어 집계한 후처리 결과. 집계 스크립트 SHA `{sha(HERE/'analyze.py')}`, 렌더 스크립트 SHA `{sha(HERE/'render_report.py')}`.
- 60분 시도와 시간상한·부분 자료는 공식 완료 블록 분모와 분리했다. 부분 CSV가 있다면 parse 가능한 행 수는 발행 시도의 **하한**이다. 상태/중단 자료:

{attempts_md}

첫 기본 시도는 12번째 셀의 Neo 적재 중 끝나 부분 측정 CSV가 없었다. 두 번째 시도는 그 셀의 기존 MySQL 적재/계획 파일 2개를 SHA와 함께 `results/interrupted-attempts/main-r02/`에 보존하고 전체 셀을 같은 입력으로 준비했다. 따라서 부분 측정 행 0건을 공식 분모에 더하지 않았다.

새 전용 DB와 **새 결과 경로**를 마련한 뒤 [`PROTOCOL.md`](PROTOCOL.md), [`run.sh`](run.sh), [`managed.sh`](managed.sh) 순서로 입력 생성→freeze→두 스모크→main→stress를 수행한다. 기존 원시 결과 경로를 덮어쓰지 않는다. 원본 제품 코드는 수정하지 않았다.

현재 Vowser가 이 기능을 제공한다거나 제품 사용자의 작업 성공률·실운영 성능이 입증됐다는 결론은 이 자료에서 나오지 않는다.
"""
    (HERE/'report.md').write_text(md)
    html = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Vowser 공유 STEP 분기 DB 프로토타입</title>
<style>@page{{size:A4 landscape;margin:8mm}}*{{box-sizing:border-box}}body{{font-family:'Noto Sans CJK KR',sans-serif;color:#1c2833;font-size:8.5pt;line-height:1.2;margin:0}}h1{{font-size:16pt;margin:1mm 0 1.5mm}}h2{{font-size:9pt;margin:2.2mm 0 1mm;color:#174e59}}p{{margin:1mm 0}}.lead{{background:#e8f3f1;border-left:3px solid #0f8c83;padding:2mm 2.5mm;font-size:8.5pt}}table{{width:100%;border-collapse:collapse;font-size:8pt;line-height:1.17}}th{{background:#e8eef1;color:#183c50;text-align:right;border-bottom:1px solid #9db0bb;padding:.8mm .65mm}}th:first-child,td:first-child{{text-align:left}}td{{text-align:right;border-bottom:1px solid #e1e8eb;padding:.7mm .65mm}}tr:nth-child(even){{background:#f8fafb}}.cells{{font-size:8pt}}.cells td,.cells th{{padding:.7mm .6mm}}.note{{color:#506876;font-size:8pt}}.grid{{display:grid;grid-template-columns:1fr 1fr;gap:3mm}}.foot{{border-top:1px solid #afc0c8;margin-top:2mm;padding-top:1mm;color:#536b77;font-size:7.5pt}}</style></head><body>
<div>VOWSER · 2026-09-29 UTC · 별도 DB 실험</div><h1>공유 STEP·분기 대체 경로</h1><p class="lead"><b>현재 제품 미구현 기능의 프로토타입.</b> 기본 16셀 정답 {main_correct:,}/{main_total:,}; 별도 깊이50/100 한계4셀 정답 {stress_correct:,}/{stress_total:,}. Neo 전반 속도 우위는 확인되지 않았고 동일 셀 일부 p50에서만 앞섰다. 아래 군별 지연은 서로 다른 셀을 합친 pooled 분포.</p>
<h2>기본 16셀 · 경로 1천/1만, 깊이 5/10/20</h2>{main_modes_html}<p class="note">정답/전체 요청, 본측정 timeout·기타 오류 및 warmup 실패를 분리. 본측정 timeout 0; warmup 실패 87건은 모두 Neo 2초 timeout.</p>{main_cells_html}
<h2>별도 50/100 연결 한계 · 제품 20연결 상한 밖</h2>{stress_modes_html}<p class="note">한계군 본측정 timeout 0; warmup 실패 24건은 모두 Neo 2초 timeout. 군별 지연은 네 셀 pooled 분포.</p>{stress_cells_html}
<div class="grid"><p><b>방법</b><br>동일 문맥·막힌 STEP 없는 완주 등록 경로 top3 전체 반환. Neo NEXT·MySQL 재귀 CTE 탐색과 양쪽 path membership 비교. 반환 대상 STEP 필드 전량 대조(`kind`는 제외). 각 DB 1 CPU/3 GiB, worker 1 CPU/1 GiB. 매 재시작 200 warmup+200 본측정/모드, DB 2초 제한.</p><p><b>해석</b><br>MySQL 소속의 바깥 SELECT에만 STRAIGHT_JOIN을 추가한 사후 새 코호트. 원본 부분 실험과 합산/개선율 비교하지 않음. 깊이와 blocker 수 동시 증가. 공유0% 상한1/2/4는 실제 분기1. 저장소는 tmpfs·공유 VM; 운영 SSD/API·브라우저/LLM 범위 밖.</p></div>
<div class="foot">원시 CSV·전체 oracle·실행계획·SHA·중단 이력: branching-revised/results/ 및 report.md. 이 결과는 현행 Vowser 제품 기능의 입증이 아님.</div></body></html>"""
    (HERE/'report.html').write_text(html)
    print(json.dumps({'report_md_sha256':sha(HERE/'report.md'),
                      'report_html_sha256':sha(HERE/'report.html'),
                      'main_correct':main_correct,'main_total':main_total,
                      'stress_correct':stress_correct,'stress_total':stress_total}))


if __name__=='__main__':
    main()
