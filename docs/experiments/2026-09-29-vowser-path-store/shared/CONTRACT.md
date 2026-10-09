# 2026-09-29 Vowser 실험 공통 계약

- 원본 프로젝트와 2026-09-28 실험 자료는 읽기 전용. 신규 MySQL `vowser-eval-v2-mysql`(127.0.0.1:19506, DB `vowser_eval_v2`)·Neo4j `vowser-eval-v2-neo4j`(bolt://127.0.0.1:19587)만 사용. 기존 중지 `vowser-eval-db-neo4j` 보존.
- 비밀번호 변수는 `EVAL_DB_PASSWORD`, 저장소 밖 `/tmp/vowser-eval-v2/credentials.env`(0600). worker 내부 경로 `/run/secrets/credentials.env`. 비밀번호 출력·원시 결과 저장 금지.
- 두 DB 각각 1 CPU/3 GiB; Python worker 각각 1 CPU/1 GiB. 한 비교군의 총 예산 2 CPU/4 GiB. 본측정은 반대쪽 DB를 `db-control.sh stop`으로 정지한 뒤 대상 DB `start`/`ready`와 드라이버 스모크를 수행. `run-client.sh`는 Python 3.12, NumPy 2.2.6, FAISS CPU 1.13.2, neo4j 5.28.2, PyMySQL 1.1.2, mysql-connector-python 9.4.0, psutil 7.0.0, cryptography 46.0.3 설치 이미지 사용. 선택적인 `EVAL_CLIENT_NAME=search`는 전용 컨테이너 이름 `vowser-eval-v2-search` 생성. FAISS는 이 worker에 임베드하며 별도 네트워크 홉 없음.
- `from shared.data import path_record, iter_paths`: `path_id`는 정수 0..N-1. 전체 규모 N=1,000/10,000/30,000이며 작은 규모가 30,000개의 정확한 prefix. `depth=(5,10,20)[path_id % 3]`은 NEXT_STEP edge 수, STEP 수는 depth+1. 1k/10k에서 깊이별 건수 차이는 최대 1.
- 도메인은 `d00.example.test`~`d29.example.test` 30개. 세 깊이를 한 group으로 묶음. `uniform`: group%30, `skew`: 짝수 group은 d00, 홀수 group은 나머지 29개에 순환 배분. 모든 깊이에서 같은 도메인 분포. `domain_id(path_id, distribution)`은 0..29, `intent_id(path_id)=(path_id//3)%96`은 0..95. intent는 `task-{intent_id:02d}`, session_id는 `v2-session-{path_id:06d}`. `path_record`에도 두 정수 ID 포함.
- STEP ID는 원본 `neo4j_service.create_step_id`와 동일한 `md5(f"{session_id}_{url}_{selectors[0]}_{action}")`. 단계 순서와 URL·selector·action·설명은 `data.py`의 `steps` 배열이 단일 원본. 벡터·질의·정답은 실험 1이 별도 동결하며 합성 의미 검색을 실제 한국어 의미 성능으로 해석하지 않음.
- Python 연결 함수는 `shared.connect.mysql_connection()`과 `shared.connect.neo4j_driver()`. worker에서 `EVAL_CREDENTIALS_PATH=/run/secrets/credentials.env`가 자동 설정. `shared.export_manifest`는 벡터·분기 실험에서 동일 ID를 조인할 수 있는 path-level JSONL 생성기.
- 논리 데이터는 공유하지만 실험별 물리 객체는 분리: 검색 `sr1_*`/`SR1_*`, 운영 `op2_*`/`OP2_*`, 확장 `br3_*`/`BR3_*`. 각 담당자는 다른 실험 객체와 컨테이너·볼륨을 삭제하지 않음. 본측정은 실험 1→2→3 순차, 자원 사용 시점 부모 조율.
