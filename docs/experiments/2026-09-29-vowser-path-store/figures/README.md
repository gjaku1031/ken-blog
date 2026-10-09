# 그림

글에 넣은 그림의 원본. `.claude/skills/ken-blog-experiments/scripts/render-figure.cjs`로 밝은·어두운 PNG를 만듦.

| 파일 | 내용 | 데이터 |
| --- | --- | --- |
| `pathstore-design.html` | 같은 조건, 한 번에 DB 하나, 라운드별 순서 교차, 블록마다 워밍업·되돌림·정답 대조 | `operations/PROTOCOL.md`, `operations/report.md` |
| `pathstore-result.html` | 경로 3만 개·균등·90:10의 연산별 p50·p95, Neo4j 저장 배치화 보조 진단 | `operations/results/summary.json`, `operations/results/source-diagnostic-*.csv` |

```bash
node .claude/skills/ken-blog-experiments/scripts/render-figure.cjs docs/experiments/2026-09-29-vowser-path-store/figures/pathstore-result.html out/pathstore-result
```
