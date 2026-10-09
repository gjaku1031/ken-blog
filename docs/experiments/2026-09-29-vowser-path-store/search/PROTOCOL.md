# 실험 1: 의도 후보 검색부터 완전한 실행 경로 반환까지

상태: 준비 중. 본측정 미실행. 원본 Vowser 소스와 2026-09-28 실험 자료는 변경하지 않음.

## 질문과 비교군

Vowser의 현재 조회 계약에서 Neo4j 관계 벡터 후보와 STEP 연결을 사용해 전체 경로를 반환할 때, 동일 자원 예산의 MySQL 8.4 + 임베디드 FAISS보다 품질·정합을 유지하면서 지연 또는 관리 구성이 개선되는가?

1. `neo_original`: 원본 `search_paths_by_query`의 관측 가능한 알고리즘을 실험 어댑터에서 재현. `HAS_STEP.intentEmbedding` 관계 ANN을 `limit*5`만큼 조회 → ROOT 도메인 필터 → Cypher `LIMIT limit` → Python exact cosine 재정렬 → 선택된 시작 STEP마다 `NEXT_STEP*0..20` 말단 경로 조회. 인덱스 bootstrap과 사전 고정 임베딩 주입만 평가용 조정. 원본 코드를 직접 수정하거나 개선 결과와 합치지 않음.
2. `neo_optimized`: 동일 관계 자료에 대해 벡터 후보·코사인 정렬·복수 경로 복원을 한 Cypher 호출로 묶음. 힌트 없음은 고정된 ANN 후보 예산 사용, 힌트 있음은 ROOT 도메인을 먼저 제한한 뒤 해당 관계 벡터의 exact cosine으로 상위 후보를 고름. 정확 도메인 스캔이라는 알고리즘 차이를 결과에 명시. Neo4j의 `vector.similarity.cosine()`은 `(1+raw cosine)/2` 점수이므로 `2*score-1`로 변환해 원본 Python 코사인과 동일한 `>0.3` 필터·정렬을 사용하며 스모크에서 numpy raw dot과의 절대차 `≤1e-4` 확인.
3. `mysql_faiss`: 동일 벡터를 worker의 FAISS HNSW 인덱스에 한 번 적재. 힌트 없음은 전역 인덱스, 힌트 있음은 도메인별 인덱스 사용. 후보 exact cosine 재정렬 후 MySQL `(path_id,ordinal)` 인덱스로 상위 경로 STEP을 한 번에 조회. MySQL에 벡터 전체를 요청마다 전송하지 않음.

세 군 모두 동일 JSON 응답 계약 `domain,taskIntent,relevance_score,weight,steps[order,url,action,selectors,description,isInput,inputType,inputPlaceholder,shouldWait,waitMessage,textLabels]`을 만든다. 검색 의도 상위 K의 `path_id`와 모든 반환 필드를 저장 원본 및 exact oracle로 비교한다. 후보 품질이 다르면 지연을 공정한 동일 품질 결과로 해석하지 않는다.

## 데이터와 질의

- 규모: 전체 등록 경로 `1,000 / 10,000 / 30,000`. 각 규모에서 깊이 `5 / 10 / 20`의 경로 수를 균등(최대 차이 1) 배치. STEP 노드는 각 경로 전용이며 모든 비교군의 논리 자료가 같다.
- 도메인: 30개. 균등 분포와 하나의 도메인에 50%가 집중된 분포를 각각 실행. 각 분포와 규모는 독립 재적재하며 해당 조건 외 자료가 ANN 인덱스에 섞이지 않도록 확인.
- 벡터: seed 고정 `1536`차원 정규화 float32 합성 클러스터. 48개의 부모 prototype에서 가깝고 서로 다른 2개씩의 의도 prototype을 만들고, 경로에는 의도·도메인 성분과 독립 잡음을 합성. query는 경로 벡터 복사가 아니라 별도 seed의 의도·도메인 성분과 독립 잡음으로 생성. 같은 클러스터·인접 클러스터의 다수 경로가 distractor가 되며 exact cosine 상위 K를 사후 oracle로 계산. 임베딩 API 호출 없음. 한국어 의미 이해, 원본 OpenAI 정확도, LLM, STT, 사용자 전체 지연으로 해석하지 않음.
- 질의: 분포마다 학습용 50개와 측정용 200개를 서로 다른 query ID와 독립 잡음으로 생성. 측정용 앞 10개와 학습용 2개는 prototype과 무관한 OOD 벡터. 나머지 질의의 `(intent, domain)`은 첫 1k 경로의 같은 group에서 뽑아 분포별로 실제 후보가 존재하도록 함. 같은 분포의 측정용 200개에 대해 힌트 유무를 짝지어 비교. oracle은 도메인 조건을 먼저 적용하고 원본과 같이 raw cosine `>0.3`인 eligible 경로만 대상으로 exact 상위 3/10개. 정답 없는 문장은 전체 200개 분모에 남기되 recall@K 분모에서는 빼고 **무응답 정합**을 별도 표시하며, 빈 정답을 recall 1점으로 계산하지 않음. 무힌트·힌트 각각 top3 본조건, top10 진단조건. 별도 불일치 차원(1535) 진단은 본 성능 분모에서 제외하고 입력 오류 처리만 기록; 본 조건은 전부 동일한 유효 1536차원 벡터.
- ANN 품질: 학습용 50개만으로 각 구현의 후보 예산/FAISS `efSearch`를 사전 격자에서 같은 시도 횟수 내 선택. 본측정 200개 질의의 recall@3 목표 `≥0.95`. 미달 조건을 포함해 보고하며, 해당 조건의 지연 우위를 주장하지 않음. 원본 후보 부족·`LIMIT` 선행으로 인한 품질 저하는 결함 관측값으로 보존.
- 저장 모델: 현재 검색에서 사용되지 않는 ROOT/STEP 임베딩은 두 DB 모두 생략하고 의도 관계 벡터만 저장. 이는 **검색 전용 투영 모델**이며 원본 전체 저장 모델의 디스크 우위라고 주장하지 않음. MySQL의 벡터 원본 BLOB과 worker의 FAISS 인덱스도 전체 저장량에 포함.

## 실행 순서와 자원

새 `vowser-eval-v2-{neo4j,mysql}`만 사용. DB별 상한 `1 CPU / 3 GiB`, worker `1 CPU / 1 GiB`, 한 시점에 DB 하나와 worker 하나만 동작하도록 총 `2 CPU / 4 GiB` 이내로 제한. 이미지·DB·드라이버·FAISS 버전, 호스트 CPU/RAM 및 VM 동시 부하를 기록. 기존 Vowser·ken-blog 운영 컨테이너에 연결·종료하지 않음.

FAISS 전역 인덱스, 도메인별 인덱스 30개, 원본 float32 배열 및 Python 객체를 모두 worker 1 GiB에 산입. 30k 조건의 스모크에서 RSS/컨테이너 메모리 사용을 확인하고 한도 초과 시 첫 실패를 보존한 뒤 부모와 양쪽 동일 축소 조건을 검토. 군 전환에 DB 재시작이 필요하면 startup·인덱스 ONLINE 시간은 타이밍에서 제외하되 매 전환마다 200 warmup 및 초기/후반 지연 안정성을 기록.

사전 자원 확인: 30k/skew의 MySQL BLOB 전체를 읽어 FAISS 전역 30k와 도메인별 총 30k를 worker 1 GiB에서 구축. process peak RSS `851,496,960 B`, cgroup peak `824,885,248 B`, 제한 `1,073,741,824 B`; 적재 `42.83 s`, 인덱스 구축 `20.18 s`. 원자료 `loads/preflight_mysql_skew_30000.memory_preflight.json`; 이는 본 검색 지연에 포함하지 않음. 30k 본측정 중 실제 요청 RSS도 별도 저장하며 여유 소진 시 실패를 포함해 보고.

1. shared 데이터 계약/DDL과 이 폴더의 seed·쿼리·oracle·코드 해시를 동결. 부모 검토 전 1k 스모크에서 각 군이 정확한 JSON을 반환하고 데이터·분모·인덱스 상태를 확인.
2. 부모의 순서 승인 후 실험 1 본측정 시작. 각 규모×분포마다 **train 50개만** 사용해 후보 예산을 한 번 선택하고 이후 3라운드에 고정. 한 라운드는 각 군에 대해 `topK=3/10`×힌트 유무의 네 조건을 실행하며, 조건마다 군별 train 질의 200회 warmup과 test 200회 측정을 수행. 3라운드 전체에서 조건별 군별 warmup 600회, test 600회. 같은 test 200개를 반복하므로 품질 비율의 독립 표본 수는 200개로 계산. 한 DB만 켜는 예산 때문에 Neo 원본·개선은 질의마다 AB/BA 순서를 seed 고정으로 섞고, MySQL은 별도 worker 블록에서 측정. 규모×분포별 DB 블록 순서는 라운드 0 `Neo→MySQL`, 라운드 1 `MySQL→Neo`, 라운드 2 `Neo→MySQL`; 다른 규모×분포의 절반은 시작군을 반대로 하여 균형화. 전환 때 반대 DB를 중지하고 새 DB ready·드라이버 인증 확인, startup 시간 제외, 각 블록 warmup 200회 재실행. 각 요청에 양 DB 공통 30초 전체 타임아웃을 적용하고 오류·시간초과 시 기존 연결을 폐기해 새 연결을 준비. 실패는 600회 분모에 포함하고 재준비 비용은 별도 기록. 전환 없는 연속 블록은 DB 재시작 없이도 warmup을 다시 실행.
3. 단계별 지연: ANN/후보, 도메인 필터·재정렬, 경로 복원, JSON 구성, 전체 worker 왕복. DB 왕복 횟수·반환 바이트·실패·정합·ANN recall·메모리·디스크·인덱스 구축 시간 보존. DB PROFILE/EXPLAIN 지표는 동일 단위로 오인해 직접 비교하지 않음.
4. 조건별 원시 CSV/JSON과 전체 실패 목록, 한 장 PDF 및 상세 Markdown 보고서 작성. 기존 DB 실험 원자료를 덮어쓰거나 새 실험 DB를 종료 전 임의로 삭제하지 않음.

Neo4j 점수 범위와 변환 근거: [Neo4j 5 벡터 인덱스 공식 문서](https://neo4j.com/docs/cypher-manual/5/indexes/semantic-indexes/vector-indexes/). 원본 알고리즘은 실험 어댑터가 재현하며 원본 서비스 함수 그 자체의 구동 지연이나 전체 사용자 요청 지연이 아님.

단일 클라이언트 측정은 처리량 상한이 아니다. 본측정 요청 순서/seed/질의/오류/환경을 모두 저장하고, 결과를 보고 벡터·정답·후보 격자·비교군 구현을 수정하지 않는다.

재현 순서: `PYTHONPATH=experiments/2026-09-29 python -m search.freeze verify`로 SHA를 확인한 뒤, 부모 승인 시에만 `python -m search.run_config --n 1000 --distribution uniform --label <고유실행ID> --authorized-by-parent`를 실행. 이 스크립트가 `shared/run-client.sh`의 1 CPU/1 GiB worker와 `shared/db-control.sh`의 전용 DB 하나만 사용해 적재·학습 보정·3회 교차 측정·로그를 남김. 다른 규모·분포는 각각 새 고유 ID로 실행. 전체 원시 JSONL을 `python -m search.report --inputs <12개 결과×3라운드> --output <빈 보고서 폴더>`로 요약. `build_oracle.py`의 frozen 절대 import를 위해 worker 명령에는 `PYTHONPATH=/work:/work/search` 지정. 데이터·인덱스 구축·FAISS 초기화·재시작은 응답 타이머 밖이며 별도 JSON·schedule 로그에 기록.
