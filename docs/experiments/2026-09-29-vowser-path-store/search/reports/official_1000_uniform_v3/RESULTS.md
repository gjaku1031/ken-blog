# 실험 1 검색 비교 결과

고정 합성 1536차원 벡터의 의도 후보 검색부터 전체 경로 반환까지의 어댑터 측정. 한국어 의미 검색, 원본 OpenAI 모델, LLM, STT 또는 전체 Vowser 요청 지연 결과가 아님.

각 행 200개의 서로 다른 test 질의를 3회 반복. 지연 p50/p95는 성공 요청 기준, 실패는 600회 전체 분모에 별도 기록. 정합·recall은 첫 회차의 서로 다른 질의 기준. 정답 없는 질의는 recall 분모에서 빼고 무응답 정합으로 분리. 정확 순서의 Wilson 95% 구간은 200개 중 답 있는 질의의 이항 비율 기준이며 생성 질의 모집단에만 적용.

|분포|경로|조건|군|p50 ms|p95 ms|Top1|정확순서/답있음|평균 recall|후보 recall@3|무응답|실패/600|왕복|RSS MiB|
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
|uniform|1000|hint_top10|mysql_faiss|1.910|2.025|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.7|
|uniform|1000|hint_top3|mysql_faiss|1.852|1.956|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.7|
|uniform|1000|no_hint_top10|mysql_faiss|4.550|5.138|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.7|
|uniform|1000|no_hint_top3|mysql_faiss|2.052|2.460|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.2|
|uniform|1000|hint_top10|neo_optimized|10.782|11.910|190/190|190/190|1.000|1.000|10/10|0/600|1.000|85.0|
|uniform|1000|hint_top10|neo_original|36.670|60.288|190/190|190/190|1.000|1.000|10/10|0/600|3.850|85.0|
|uniform|1000|hint_top3|neo_optimized|10.763|11.778|190/190|190/190|1.000|1.000|10/10|0/600|1.000|85.0|
|uniform|1000|hint_top3|neo_original|26.508|28.458|190/190|190/190|1.000|1.000|10/10|0/600|3.850|85.0|
|uniform|1000|no_hint_top10|neo_optimized|18.640|20.539|190/190|190/190|1.000|1.000|10/10|0/600|1.000|85.0|
|uniform|1000|no_hint_top10|neo_original|76.674|86.006|190/190|169/190|0.989|1.000|10/10|0/600|10.500|85.0|
|uniform|1000|no_hint_top3|neo_optimized|10.518|12.022|190/190|190/190|1.000|1.000|10/10|0/600|1.000|83.8|
|uniform|1000|no_hint_top3|neo_original|28.581|32.222|190/190|178/190|0.979|1.000|10/10|0/600|3.850|83.8|

후보 recall이 0.95 미만이거나 반환 경로 정합이 실패한 조건의 지연 우위를 동일 품질 성능으로 해석하지 않음. `neo_original`은 원본 알고리즘 재현 어댑터로, 원본 서비스 함수 자체를 호출한 측정이 아님. 힌트 있는 `neo_optimized`의 후보 방법은 ANN이 아닌 도메인 관계 exact scan.

## 실패 및 원자료

- 전체 실패 요청: 0
- 원시 JSONL SHA-256:
  - `search/runs/official_1000_uniform_v3_mysql_uniform_1000_r0.jsonl`: `d133482b15ef352ca384fec1afac8a9d58d14123601871f33b5614c9a5c28ea6`
  - `search/runs/official_1000_uniform_v3_mysql_uniform_1000_r1.jsonl`: `7483e749832da6dd7a3eaaeb198e31932036a50cde3303662cae714bb34021b3`
  - `search/runs/official_1000_uniform_v3_mysql_uniform_1000_r2.jsonl`: `1ac152cf7ac327918558d200454857e66ccd075662e7c992680b2e893d7ae2ad`
  - `search/runs/official_1000_uniform_v3_neo_uniform_1000_r0.jsonl`: `96f44008bbe9cfa49efee7b6e018ecafa4a4c334d04a8726a8529553118c33ad`
  - `search/runs/official_1000_uniform_v3_neo_uniform_1000_r1.jsonl`: `1700195bd6c39afdf3985c74eaed7d818afd23b32c7fb3438e594c54dd7316af`
  - `search/runs/official_1000_uniform_v3_neo_uniform_1000_r2.jsonl`: `b9f84a67de32e11d9b2e8181c9d33f4d9b6f8a771d28d2cd75692bdfe231601c`

단계별 지연은 `phases.csv`, 라운드별 첫/마지막 50회 warmup p50은 `summary.json`의 `warmup_blocks`에 보존. 반환 추정 바이트·raw score·payload SHA-256·질의 ID·반복 ID·에러는 원시 JSONL에 보존. PDF는 top3 중심의 한 장 요약.
