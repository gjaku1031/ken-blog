# 실험 1 검색 비교 결과

고정 합성 1536차원 벡터의 의도 후보 검색부터 전체 경로 반환까지의 어댑터 측정. 한국어 의미 검색, 원본 OpenAI 모델, LLM, STT 또는 전체 Vowser 요청 지연 결과가 아님.

각 행 200개의 서로 다른 test 질의를 3회 반복. 지연 p50/p95는 성공 요청 기준, 실패는 600회 전체 분모에 별도 기록. 정합·recall은 첫 회차의 서로 다른 질의 기준. 정답 없는 질의는 recall 분모에서 빼고 무응답 정합으로 분리. 정확 순서의 Wilson 95% 구간은 200개 중 답 있는 질의의 이항 비율 기준이며 생성 질의 모집단에만 적용.

|분포|경로|조건|군|p50 ms|p95 ms|Top1|정확순서/답있음|평균 recall|후보 recall@3|무응답|실패/600|왕복|RSS MiB|
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
|skew|1000|hint_top10|mysql_faiss|4.118|4.718|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.8|
|skew|1000|hint_top3|mysql_faiss|1.902|2.434|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.8|
|skew|1000|no_hint_top10|mysql_faiss|4.671|5.126|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.8|
|skew|1000|no_hint_top3|mysql_faiss|2.042|2.534|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.4|
|skew|10000|hint_top10|mysql_faiss|4.000|5.445|189/190|188/190|0.999|0.998|10/10|0/600|0.950|386.7|
|skew|10000|hint_top3|mysql_faiss|2.039|2.599|189/190|189/190|0.998|0.998|10/10|0/600|0.950|386.7|
|skew|10000|no_hint_top10|mysql_faiss|4.670|5.549|190/190|182/190|0.996|1.000|10/10|0/600|0.950|386.7|
|skew|10000|no_hint_top3|mysql_faiss|2.100|2.629|190/190|190/190|1.000|1.000|10/10|0/600|0.950|383.7|
|skew|30000|hint_top10|mysql_faiss|4.746|5.544|188/190|170/190|0.988|0.988|10/10|0/600|0.950|985.5|
|skew|30000|hint_top3|mysql_faiss|2.169|2.714|188/190|183/190|0.988|0.988|10/10|0/600|0.950|985.4|
|skew|30000|no_hint_top10|mysql_faiss|4.857|5.875|189/190|152/190|0.975|0.988|10/10|0/600|0.945|985.4|
|skew|30000|no_hint_top3|mysql_faiss|2.230|2.672|189/190|185/190|0.988|0.988|10/10|0/600|0.945|981.0|
|uniform|1000|hint_top10|mysql_faiss|1.910|2.025|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.7|
|uniform|1000|hint_top3|mysql_faiss|1.852|1.956|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.7|
|uniform|1000|no_hint_top10|mysql_faiss|4.550|5.138|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.7|
|uniform|1000|no_hint_top3|mysql_faiss|2.052|2.460|190/190|190/190|1.000|1.000|10/10|0/600|0.950|115.2|
|uniform|10000|hint_top10|mysql_faiss|4.588|5.282|190/190|190/190|1.000|1.000|10/10|0/600|0.950|386.3|
|uniform|10000|hint_top3|mysql_faiss|2.029|2.546|190/190|190/190|1.000|1.000|10/10|0/600|0.950|386.3|
|uniform|10000|no_hint_top10|mysql_faiss|4.756|5.692|190/190|187/190|0.998|0.998|10/10|0/600|0.950|386.3|
|uniform|10000|no_hint_top3|mysql_faiss|2.145|2.671|190/190|189/190|0.998|0.998|10/10|0/600|0.950|382.3|
|uniform|30000|hint_top10|mysql_faiss|4.784|5.599|190/190|189/190|0.999|1.000|10/10|0/600|0.950|987.0|
|uniform|30000|hint_top3|mysql_faiss|2.091|2.600|190/190|190/190|1.000|1.000|10/10|0/600|0.950|987.0|
|uniform|30000|no_hint_top10|mysql_faiss|4.894|5.680|187/190|167/190|0.977|0.984|10/10|0/600|0.940|987.0|
|uniform|30000|no_hint_top3|mysql_faiss|2.192|2.700|187/190|185/190|0.984|0.984|10/10|0/600|0.940|970.0|
|skew|1000|hint_top10|neo_optimized|53.117|59.945|190/190|190/190|1.000|1.000|10/10|0/600|1.000|84.0|
|skew|1000|hint_top10|neo_original|71.588|78.332|190/190|186/190|0.998|1.000|10/10|0/600|7.240|84.0|
|skew|1000|hint_top3|neo_optimized|48.534|56.412|190/190|190/190|1.000|1.000|10/10|0/600|1.000|84.0|
|skew|1000|hint_top3|neo_original|27.050|32.232|190/190|186/190|0.993|1.000|10/10|0/600|3.850|84.0|
|skew|1000|no_hint_top10|neo_optimized|18.648|20.201|190/190|190/190|1.000|1.000|10/10|0/600|1.000|84.0|
|skew|1000|no_hint_top10|neo_original|77.972|84.024|190/190|174/190|0.992|1.000|10/10|0/600|10.500|84.0|
|skew|1000|no_hint_top3|neo_optimized|10.537|12.078|190/190|190/190|1.000|1.000|10/10|0/600|1.000|83.3|
|skew|1000|no_hint_top3|neo_original|29.330|33.202|190/190|180/190|0.982|1.000|10/10|0/600|3.850|83.3|
|skew|10000|hint_top10|neo_optimized|442.876|462.047|190/190|190/190|1.000|1.000|10/10|0/600|1.000|137.1|
|skew|10000|hint_top10|neo_original|75.129|80.289|190/190|122/190|0.951|1.000|10/10|0/600|8.670|137.1|
|skew|10000|hint_top3|neo_optimized|437.465|455.275|190/190|190/190|1.000|1.000|10/10|0/600|1.000|137.1|
|skew|10000|hint_top3|neo_original|27.904|29.859|190/190|150/190|0.926|0.972|10/10|0/600|3.775|137.1|
|skew|10000|no_hint_top10|neo_optimized|21.892|25.458|190/190|190/190|1.000|1.000|10/10|0/600|1.000|137.1|
|skew|10000|no_hint_top10|neo_original|78.627|86.287|190/190|112/190|0.957|1.000|10/10|0/600|10.500|137.1|
|skew|10000|no_hint_top3|neo_optimized|12.014|13.646|190/190|190/190|1.000|1.000|10/10|0/600|1.000|133.4|
|skew|10000|no_hint_top3|neo_original|29.905|33.831|190/190|150/190|0.930|1.000|10/10|0/600|3.850|133.4|
|uniform|1000|hint_top10|neo_optimized|10.782|11.910|190/190|190/190|1.000|1.000|10/10|0/600|1.000|85.0|
|uniform|1000|hint_top10|neo_original|36.670|60.288|190/190|190/190|1.000|1.000|10/10|0/600|3.850|85.0|
|uniform|1000|hint_top3|neo_optimized|10.763|11.778|190/190|190/190|1.000|1.000|10/10|0/600|1.000|85.0|
|uniform|1000|hint_top3|neo_original|26.508|28.458|190/190|190/190|1.000|1.000|10/10|0/600|3.850|85.0|
|uniform|1000|no_hint_top10|neo_optimized|18.640|20.539|190/190|190/190|1.000|1.000|10/10|0/600|1.000|85.0|
|uniform|1000|no_hint_top10|neo_original|76.674|86.006|190/190|169/190|0.989|1.000|10/10|0/600|10.500|85.0|
|uniform|1000|no_hint_top3|neo_optimized|10.518|12.022|190/190|190/190|1.000|1.000|10/10|0/600|1.000|83.8|
|uniform|1000|no_hint_top3|neo_original|28.581|32.222|190/190|178/190|0.979|1.000|10/10|0/600|3.850|83.8|
|uniform|10000|hint_top10|neo_optimized|42.621|45.325|190/190|190/190|1.000|1.000|10/10|0/600|1.000|135.1|
|uniform|10000|hint_top10|neo_original|78.252|82.720|190/190|138/190|0.972|1.000|10/10|0/600|10.500|135.1|
|uniform|10000|hint_top3|neo_optimized|37.374|44.464|190/190|190/190|1.000|1.000|10/10|0/600|1.000|135.1|
|uniform|10000|hint_top3|neo_original|28.407|32.984|190/190|164/190|0.954|1.000|10/10|0/600|3.850|135.1|
|uniform|10000|no_hint_top10|neo_optimized|21.928|25.489|190/190|190/190|1.000|1.000|10/10|0/600|1.000|135.1|
|uniform|10000|no_hint_top10|neo_original|79.686|93.744|190/190|128/190|0.966|1.000|10/10|0/600|10.500|135.1|
|uniform|10000|no_hint_top3|neo_optimized|11.869|13.515|190/190|190/190|1.000|1.000|10/10|0/600|1.000|132.4|
|uniform|10000|no_hint_top3|neo_original|29.815|34.226|190/190|161/190|0.949|1.000|10/10|0/600|3.850|132.4|

후보 recall이 0.95 미만이거나 반환 경로 정합이 실패한 조건의 지연 우위를 동일 품질 성능으로 해석하지 않음. `neo_original`은 원본 알고리즘 재현 어댑터로, 원본 서비스 함수 자체를 호출한 측정이 아님. 힌트 있는 `neo_optimized`의 후보 방법은 ANN이 아닌 도메인 관계 exact scan.

## 실패 및 원자료

- 전체 실패 요청: 0
- 원시 JSONL SHA-256:
  - `search/runs/official_10000_skew_v3_mysql_skew_10000_r0.jsonl`: `e4990edeb94c90cea861a7e0884b828cdcab6dac88b37201246fe9774ae29d58`
  - `search/runs/official_10000_skew_v3_mysql_skew_10000_r1.jsonl`: `4f4dcf16569422faa52a2911fda445374a601db2339306c9b0f28aa7035a5cfe`
  - `search/runs/official_10000_skew_v3_mysql_skew_10000_r2.jsonl`: `9e3136eb8d98b20031484709ae563f4a15bdb2433ccc361763b9e4c61dd8844f`
  - `search/runs/official_10000_skew_v3_neo_skew_10000_r0.jsonl`: `f4cf49032ecd53a9f90b44575133cd7ec25cc1da63639b99668b546ee5340a00`
  - `search/runs/official_10000_skew_v3_neo_skew_10000_r1.jsonl`: `bb74406055c735b4306f5910b50c6f725bafa260230e21a04d405b99d914504e`
  - `search/runs/official_10000_skew_v3_neo_skew_10000_r2.jsonl`: `0e17d1ea040a3db94d692ce093f24ff2bc4a433493992d8ed564ad13c76719ca`
  - `search/runs/official_10000_uniform_v3_mysql_uniform_10000_r0.jsonl`: `07070dc78fbd70dd8a5d53383e58dee95f4fb0835e2e555ba14afe9653056484`
  - `search/runs/official_10000_uniform_v3_mysql_uniform_10000_r1.jsonl`: `4d97cf00b948b4e0def59c473529555b5b72e9cd64c8b43c2eb6546c83c27141`
  - `search/runs/official_10000_uniform_v3_mysql_uniform_10000_r2.jsonl`: `0ba3e11eade7b1b93424142a90ecc3e3737552bf7feb7580485ee0525bcbd837`
  - `search/runs/official_10000_uniform_v3_neo_uniform_10000_r0.jsonl`: `3abb21f30e8b286e87703f00558d109528b4ab1283d07f4ecfdb7af1094bc3b2`
  - `search/runs/official_10000_uniform_v3_neo_uniform_10000_r1.jsonl`: `672213a13435667fcdeaa5a9cdf4629b778f2d1a3febd07d72421ee80c13a4fa`
  - `search/runs/official_10000_uniform_v3_neo_uniform_10000_r2.jsonl`: `dbd9998a993171b66c5d748368bd87ceb7c4402f3f542f6ca989683f9735bce9`
  - `search/runs/official_1000_skew_v3_mysql_skew_1000_r0.jsonl`: `7a820552dad859332d6cb3635e583389daebcf4a994c18b36bdeac4db8a4e618`
  - `search/runs/official_1000_skew_v3_mysql_skew_1000_r1.jsonl`: `1503df5da0059a2aed167c28ad71026a19a875313b30abc64ea4257919d3bfeb`
  - `search/runs/official_1000_skew_v3_mysql_skew_1000_r2.jsonl`: `88462582539847b5bb618afd55a7bde0172fbee26e557638c5314169ccd69819`
  - `search/runs/official_1000_skew_v3_neo_skew_1000_r0.jsonl`: `8c115234a0aa18c6a8cb7ad214a14f9b7b5eddb4278dffba105e010dab08db61`
  - `search/runs/official_1000_skew_v3_neo_skew_1000_r1.jsonl`: `3607f04002acbcd2ef5772cef31679f15e7cdb0978e2758dd6a2749f5d386d23`
  - `search/runs/official_1000_skew_v3_neo_skew_1000_r2.jsonl`: `1cca6c3dc136b4b076c0dee1be6646b2502fc9dcaf7c9529563226c292433244`
  - `search/runs/official_1000_uniform_v3_mysql_uniform_1000_r0.jsonl`: `d133482b15ef352ca384fec1afac8a9d58d14123601871f33b5614c9a5c28ea6`
  - `search/runs/official_1000_uniform_v3_mysql_uniform_1000_r1.jsonl`: `7483e749832da6dd7a3eaaeb198e31932036a50cde3303662cae714bb34021b3`
  - `search/runs/official_1000_uniform_v3_mysql_uniform_1000_r2.jsonl`: `1ac152cf7ac327918558d200454857e66ccd075662e7c992680b2e893d7ae2ad`
  - `search/runs/official_1000_uniform_v3_neo_uniform_1000_r0.jsonl`: `96f44008bbe9cfa49efee7b6e018ecafa4a4c334d04a8726a8529553118c33ad`
  - `search/runs/official_1000_uniform_v3_neo_uniform_1000_r1.jsonl`: `1700195bd6c39afdf3985c74eaed7d818afd23b32c7fb3438e594c54dd7316af`
  - `search/runs/official_1000_uniform_v3_neo_uniform_1000_r2.jsonl`: `b9f84a67de32e11d9b2e8181c9d33f4d9b6f8a771d28d2cd75692bdfe231601c`
  - `search/runs/official_30000_skew_mysql_only_v3_mysql_skew_30000_r0.jsonl`: `f9e43603d31deef4f5bdc451de011beb19fe39a7b1baa0bbf6e72c4f30ca49b0`
  - `search/runs/official_30000_skew_mysql_only_v3_mysql_skew_30000_r1.jsonl`: `7e39759bd6ae3442dcac577d7f08c05b77980765fe8812379dc2013549d244c9`
  - `search/runs/official_30000_skew_mysql_only_v3_mysql_skew_30000_r2.jsonl`: `a7219470155aa93da0f3c0fd7192b532089b5fc0584fc2b14e9a208d5a8edb0f`
  - `search/runs/official_30000_uniform_mysql_only_v3_mysql_uniform_30000_r0.jsonl`: `e8bcd35ee3f7d8bc9bdc9f28c733cef39bec91d2c10c9500e0e0e096e8646cbd`
  - `search/runs/official_30000_uniform_mysql_only_v3_mysql_uniform_30000_r1.jsonl`: `4f6dd7cfb20ffb82954024cc219eff82588b1f8e7d84996f9eb9b5dd979557f2`
  - `search/runs/official_30000_uniform_mysql_only_v3_mysql_uniform_30000_r2.jsonl`: `ecf3d40fecac1581130a4af897a7b5c30206598dee6ba0c73cbcda43760a5e7a`

단계별 지연은 `phases.csv`, 라운드별 첫/마지막 50회 warmup p50은 `summary.json`의 `warmup_blocks`에 보존. 반환 추정 바이트·raw score·payload SHA-256·질의 ID·반복 ID·에러는 원시 JSONL에 보존. PDF는 top3 중심의 한 장 요약.
