# 그림

글에 넣은 그림의 원본. `.claude/skills/ken-blog-experiments/scripts/render-figure.cjs`로 밝은·어두운 PNG를 만듦.

| 파일 | 내용 | 데이터 |
| --- | --- | --- |
| `static-design.html` | 세 구조가 ERD 문서 본문을 화면에 올리는 순서 | 옛 소스 `f29ef35`·`135169f`의 화면 코드, `results/body-location.tsv`, `results/summary.csv`의 서버 API 수 |
| `static-result.html` | ERD 문서 첫 방문의 본문 표시 시각(중앙값·p95), 네트워크 R·M | `results/summary.csv` (`erd_document`, `cold`) |

```bash
node .claude/skills/ken-blog-experiments/scripts/render-figure.cjs docs/experiments/2026-10-07-static-vs-csr/figures/static-result.html out/static-result
```
