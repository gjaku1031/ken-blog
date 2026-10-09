# 실험 2: Vowser 경로·관계 속성 운영 — 본측정 전 고정안

상태: 준비 중. 본측정은 실험 1 종료와 부모의 측정 순서 승인 후 시작. 2026-09-28 선형 경로 결과는 수정·삭제하지 않음.

## 제품 범위와 비교군

- 원본 `neo4j_service.py`의 `save_path_to_neo4j`, `find_popular_paths`, `visualize_paths`에서 사용하는 ROOT·STEP·HAS_STEP의 `taskIntent/weight`와 NEXT_STEP의 `sequenceOrder/pathId/weight`를 DB 직접 구현. 양쪽의 운영 payload는 URL·selector·action·설명·입력/대기 flag·textLabel·successRate·순서·가중치로 동일하며 전수 readback. 1536차원 STEP/의도 임베딩은 이 운영 질의에서 읽지 않아 저장하지 않고, 별도 실험 1의 벡터 비교로 분리. 실제 원본 API 전체 호출 성능이나 임베딩을 포함한 저장 비용으로 표현하지 않음.
- 주 비교군: Neo4j 5.26.19의 단일 트랜잭션·UNWIND 배치 구현과 MySQL 8.4.11의 PK/FK·도메인/가중치·양방향 edge·`(path_id,ordinal)` 인덱스 및 batch/transaction 구현. 두 군 모두 같은 logical write와 반환 payload. 원본처럼 단계별 `graph.query` 반복을 흉내 낸 Neo4j DB 직접 구현은 1k 규모 보조 진단으로만 별도 기록하고 엔진 비교에 합치지 않음.
- 호출 수는 원시 CSV에 (a) `driver_query_calls`, (b) `server_statements`, (c) `stored_proc_inner`, (d) `commit_calls`, (e) `auto_commit_transactions`로 분리. MySQL 신규 등록은 UPDATE/INSERT/두 `executemany` DML 4문장+명시 commit 1회(암묵 BEGIN), 반복 사용은 `CALL` 1회+commit 1회이며 프로시저 내부 UPDATE 4문장을 포함해 서버 문장 수 5. MySQL 인기 조회 1 SELECT, 시각화는 반환에 유효 경로가 있을 때 2 SELECT, 없으면 1 SELECT. Neo4j 주 비교 등록·갱신·조회는 각 1 Cypher와 auto-commit 1회; driver session 생성과 결과 소비를 측정에 포함. 다른 네트워크 왕복 수를 문장 수와 동일시하지 않음.
- PyMySQL 연결은 `autocommit=False` 한 개를 재사용한다. 쓰기 작업에는 별도 `BEGIN` 드라이버 호출이 없고 첫 문장에서 트랜잭션이 암묵 시작해 `commit_calls=1`로 끝난다. 읽기 전용 연산은 동일 연결의 암묵 트랜잭션을 다음 쓰기·reset까지 이어갈 수 있으나 단일 worker 외 동시 작성자는 없다. 이 암묵 경계는 요청별 네트워크 왕복 수로 가산하지 않으며, Neo4j의 작업별 auto-commit과 다른 트랜잭션 범위라는 한계를 결과에 명시한다.
- 검색 실험과 격리: MySQL `op2_*` 테이블과 Neo4j `OP2_*` 라벨/관계만 사용. 다른 실험 객체 삭제 금지. 본측정 블록에는 비교 대상 DB만 기동; 각 DB 1 CPU/3 GiB, Python 3.12 worker 1 CPU/1 GiB, 양쪽 총 2 CPU/4 GiB. worker의 NumPy·FAISS 설치는 공통이나 본 운영 질의에 ANN 사용 없음.
- 원본형 Neo4j 보조 진단은 1k 초기 990경로에서 깊이 5/10/20인 기존 경로 3개 갱신·신규 경로 3개 등록을 같은 순서로 수행. 각 round에 비측정 1회와 측정 1회, 총 3 round. 동일 6개 쓰기 작업의 Neo4j 단일 Cypher 최적화군과 별도 비교하며 주 MySQL↔Neo4j 표에 합치지 않음. 원본형은 임베딩 생성을 제외하고 ROOT 1회, STEP별 1회, HAS_STEP 또는 NEXT_STEP별 1회씩 독립 auto-commit하여 깊이 d마다 `2d+3` Cypher 호출. 최적화군은 작업마다 1 Cypher auto-commit. 이 진단은 원본 저장 호출의 트랜잭션 경계 차이를 보여줄 뿐 전체 API 호출 성능을 뜻하지 않음.

## 입력과 연산 계약

- `shared/data.py`의 `uniform` 분포, 전체 최종 경로 수 N=1,000/10,000/30,000. 각 규모에 STEP 연결 5/10/20이 ±1개 차이로 균등. 합성 데이터·원본형 단방향 선형 경로. `skew` 분포 10k는 집중 도메인에 대한 별도 진단이며 주 비교표와 구분.
- Uniform 읽기 trace는 30도메인을 순환하여 200연산의 read 중 d00 비중이 약 1/30. Skew 10k trace는 경로 절반이 있는 d00에 read의 정확히 절반을 배치하고 나머지 29도메인을 순환. 두 분포는 서로 다른 입력·읽기 workload이므로 같은 조건의 직접 속도 차이로 일반화하지 않음.
- 조건 실행 순서: uniform 1k → Neo4j 1k 원본형 보조 진단 → uniform 10k → skew 10k 진단 → uniform 30k. 각 조건의 초기 fixture는 해당 `op2_*`/`OP2_*` 객체만 삭제 후 재적재. skew는 같은 10k 규모 직후 수행하여 30k 고수위 그래프 파일이 혼입되는 순서를 피하지만, 재사용 DB storefile의 공간 고수위 효과가 남을 수 있어 skew 저장량 비교를 독립 결과로 해석하지 않음.
- 각 N의 초기 fixture는 path_id `0..N-11`의 **N−10 경로**. 각 측정 round에서 끝 10개 `N−10..N−1`을 신규 등록하여 완료 후 **N 경로**. 같은 10개 ID를 round마다 제거해 초기 상태로 되돌린 다음 재사용. 그 외 `update`는 초기 경로만 선택하고, 반복 횟수에 따라 HAS_STEP·NEXT_STEP weight와 STEP usageCount를 각각 +1. ROOT visitCount도 원본 저장 규칙에 맞춰 갱신.
- 작업 1개는 (a) 경로 등록, (b) 기존 경로 weight 갱신, (c) domain별 인기 top10, (d) domain별 시각화 top10 중 하나. 인기 반환은 domain/taskIntent/usageCount/firstStepDescription. 시각화는 taskIntent/weight/ordered descriptions/pathLength. 5·10 edge는 실제 단계 배열을 반환하고 20 edge는 원본 `*0..10` 상한으로 단계 배열이 null임을 별도 정합 확인. 동률은 양쪽 모두 `path_id` 오름차순으로 고정하여 반환을 동일하게 함(원본에 없는 결정적 tie-break 보완).
- 각 규모·read:write 조건에서 **동일 200연산 mixed trace를 비측정 warmup으로 1회 실행하고 상태를 reset**한 뒤, fresh fixture에서 같은 200연산 trace를 3회 측정. 90:10 trace는 popular 90 + visualize 90 + register 10 + update 10. 50:50 trace는 popular 50 + visualize 50 + register 10 + update 90. seed `20260929 + N + mix`로 연산·도메인·갱신 대상 순서를 사전 생성해 JSONL과 SHA 보존. 같은 trace를 Neo4j/MySQL에 적용. round 순서는 Neo→SQL, SQL→Neo, Neo→SQL로 교차하고 DB 재시작·mixed warmup·reset을 각 블록에 적용.
- 각 warmup·round 시작 전 touched 경로의 weight/usageCount/ROOT visitCount를 초기값으로 복구하고 등록된 10개 경로만 삭제해 N−10·기본 가중치 상태를 readback. reset·DB 기동·fixture 적재·warmup·정합 readback은 측정 지연에서 제외. reset 전후 수치·checksum은 JSON 보존. 별도 oracle이 각 연산 직후의 인기/시각화 결과와 최종 전체 경로 수·weight·STEP/edge payload를 검증. 30k 조건을 포함해 입력 규모별 전체 상태 checksum 기록. 시각화 원시결과마다 유효 경로 수·20-edge null 경로 수를 기록하고 지연을 반환 구성별로 구분.
- 재시작 후 TCP open만으로 준비됐다고 보지 않음. `operations.wait_db`에서 인증된 `SELECT 1`/`RETURN 1`이 통과할 때까지 최대 90초 재시도하고 그 뒤에만 비측정 warmup을 시작. 준비 시간·시도 횟수는 로그에 보존하며 계측 지연에서 제외.

## 측정과 종료 기준

- 단일 worker·연결 풀 재사용, localhost, 동일 필드 정규화. 200연산×3회 조건별 600개 개별 지연을 CSV로 저장. 연산 유형별 p50/p95, 완료·실패·timeout, DB 호출 수, round 전체 경과, DB/worker CPU·메모리, 저장량·인덱스 크기·구축 시간을 기록. 처리량은 고정 mixed trace의 완료 시간으로만 표현하고 순차 지연 합을 최대 QPS라 하지 않음. 반환값 및 서버 PROFILE/EXPLAIN은 분리 보존.
- 모든 실패·타임아웃은 분모에 포함. 원본형 Neo4j 보조 진단은 호출 수·트랜잭션 경계 차이와 함께 표기. 어느 군의 유리한 축만 선택하지 않고 N×mix×operation 전체 표 공개. 반복간 우열 변화·품질 차이는 우위 미확인으로 결론.
- 예상 상한: DB별 초기 적재는 규모당 10분, 각 N×mix×round×DB 작업은 3분, 전체 실험 45분. 초과 시 해당 조건을 실패/미완료로 보존하고 부모와 자원 조율 후 같은 사전 계약으로 재시도. 메모리 부족 시 한쪽만 축소하지 않음.
- 본측정 전 1k 소량 스모크에서 전체 payload·등록/갱신 정합 및 reset 후 상태동일성, SQL/Cypher 계획, 200회 warmup의 안정성을 확인. 스모크 결과로 변경이 필요하면 프로토콜 버전을 올리고 본측정 전에 다시 동결.
