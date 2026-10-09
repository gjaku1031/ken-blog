# Vowser 의도 검색 임계값 확증 실험 (2026-10-09)

사전 등록한 확증 실험의 계획·입력·실행기·원자료·분석 결과. 계획은 실행 전에 커밋 `7a249b1`로 고정함.

| 파일 | 내용 |
| --- | --- |
| `PLAN.md` | 연구 질문, 가설 H1~H3과 기각 기준, 변수, 설계, 타당성 위협, 분석 계획 |
| `freeze_manifest.json` | 실행 전에 고정한 파일의 SHA-256 |
| `confirmatory_queries.jsonl` | 확증용 새 합성 질의 104개(정답형 80·다의 8·미등록 16) |
| `exploratory_queries.jsonl`, `exploratory_reference.jsonl` | 가설을 만든 탐색적 평가의 질의 96개와 원본 서버 1위 결과(재현 점검용) |
| `registered_paths.jsonl` | 등록한 합성 작업 16개 |
| `harness.py` | 원본 agent 서버(커밋 d94eaf5) 함수를 불러 같은 요청에서 두 분기를 실행·기록 |
| `analyze.py` | 계획서의 분석을 그대로 계산 |
| `raw/` | 요청별 원자료(최고 유사도, 두 분기의 반환 순서, 지연, LLM 폴백 여부). 키·비밀번호 없음 |
| `results/summary.json`, `results/summary.md` | 분석 결과 |

## 결과 요약

| 가설 | 결과 | 판정 |
| --- | --- | --- |
| H1 재검색 분기보다 순위화 분기가 정확 | 1위 정답 52 대 45/80, 불일치 18 대 11, McNemar p = 0.265 | 지지하지 못함 |
| H2 임계값 0 ≥ 0.43 ≥ 0.60 (1위 정답) | 52, 52, 47 | 지지 |
| H3 최고 유사도로 미등록 요청을 잘 가르지 못함 | AUC 0.773(부트스트랩 95% 0.659~0.868) | 지지(구간이 기준 0.80을 넘나듦) |

- 실행 실패 0/200, LLM 폴백 0. 재현 점검: 탐색 질의의 0.43 계산 1위가 원본 서버 1위와 95/96 일치(기준 90%)
- 실행 환경: Neo4j 5.26.0 Community + APOC, `Dockerfile.eval`의 Python 3.12.11 이미지

재현: Neo4j(APOC)를 띄우고 `NEO4J_URI`·`NEO4J_USERNAME`·`NEO4J_PASSWORD`·`OPENAI_API_KEY`를 둔 뒤, 원본 서버 디렉터리를 작업 디렉터리로 `python harness.py register`, `python harness.py run confirmatory`, `python harness.py run exploratory`, `python analyze.py`. 탐색적 평가에서 원본 `create_vector_indexes()`가 만들지 않는 `intent_embeddings` 관계 벡터 인덱스(1536차원 cosine)를 먼저 만들어야 함.
