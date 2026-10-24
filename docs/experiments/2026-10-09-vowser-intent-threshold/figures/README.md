# 그림

글에 넣은 그림의 원본. 블로그의 그림 변환 스크립트(`render-figure.cjs`)가 HTML을 밝은·어두운 PNG 두 장으로 찍음.

| 파일 | 내용 | 데이터 |
| --- | --- | --- |
| `design.html` | 1부(한 분기만)와 2부(같은 요청에서 두 분기) 설계 비교 | 수치는 1부 원자료와 `results/summary.json` |
| `threshold.html` | 임계값별 1위·3위 안 정답과 재검색 비율 | `results/summary.json` (렌더링 때 주입) |

```bash
node render-figure.cjs figures/threshold.html out/threshold results/summary.json
```
