# 그림

측정 결과를 그린 그림의 원본. 블로그의 그림 변환 스크립트(`render-figure.cjs`)가 HTML을 밝은·어두운 PNG 두 장으로 찍음.

| 파일 | 내용 | 데이터 |
| --- | --- | --- |
| `result.html` | 세 조건에서 요청 20건이 어떻게 끝났는지와 실행 뒤의 재고 | `../results/summary.json`. 조건별로 10회가 모두 같은 값임을 확인한 뒤 옮김 |

```bash
node render-figure.cjs figures/result.html out/result
```
