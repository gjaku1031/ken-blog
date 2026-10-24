# 그림

측정 설계와 결과를 그린 그림의 원본. 블로그의 그림 변환 스크립트(`render-figure.cjs`)가 HTML을 밝은·어두운 PNG 두 장으로 찍음.

| 파일 | 내용 | 데이터 |
| --- | --- | --- |
| `static-design.html` | 세 구조가 ERD 문서 본문을 화면에 올리는 순서 | 옛 소스 `f29ef35`·`135169f`의 화면 코드, `results/body-location.tsv`, `results/summary.csv`의 서버 API 수 |
| `static-result.html` | ERD 문서 첫 방문의 본문 표시 시각(중앙값·p95), 네트워크 R·M | `results/summary.csv` (`erd_document`, `cold`) |

```bash
node render-figure.cjs docs/experiments/2026-10-07-static-vs-csr/figures/static-result.html out/static-result
```
