# 실험 2 — 경로 등록·인기·가중치·시각화 운영

2026-09-29 완료. **이 조건에서는 인덱싱한 MySQL이 Neo4j보다 빨랐다.** 8개 입력·혼합조건의 네 연산 모두 MySQL p50·p95가 낮았고, 순차 혼합 처리량도 8/8조건에서 높았다. 따라서 이 실험을 Neo4j의 속도 우위 근거로 사용할 수 없다. 다만 원본처럼 STEP/관계를 개별 Cypher로 저장하는 대신 배치 트랜잭션으로 묶었을 때 Neo4j 자체의 운영 호출은 크게 줄었다. 이는 **Neo4j 구현 개선 효과**이며 MySQL 대비 우위와 별개다.

## 측정 범위와 공정 조건

- Vowser `neo4j_service.py`의 ROOT–HAS_STEP–STEP–NEXT_STEP, `save_path_to_neo4j`·`find_popular_paths`·`visualize_paths`를 따른 DB 직접 구현. 경로 URL·selector·action·설명·입력/대기 flag·textLabel·successRate·순서·가중치와 반환 payload를 양쪽 전수 비교. 원본 API 전체·임베딩 생성·1536차원 벡터 속성 저장·LLM 호출은 제외. 검색 실험의 벡터 포함 30k Neo4j OOM과 본 실험의 **벡터 제외 30k 적재 성공**은 서로 다른 물리 투영이므로 모순되지 않는다.
- 공통 단방향 선형 STEP 경로, 최종 N=1,000/10,000/30,000. 깊이 5/10/20 edge 균등(±1), 시작 N−10경로에 고정 trace의 신규 10경로를 등록해 완료 N경로. 10k 쏠림 분포는 별도 진단: 경로 절반이 d00에 있고 읽기 절반을 d00에 지정. 공유 STEP·분기는 현재 기능이 아닌 실험 3 범위.
- 주비교는 **양쪽 최적 배치**: Neo4j 단일 Cypher/auto-commit과 MySQL PK/FK·도메인/가중치·`(path_id,ordinal)` 인덱스, 등록 batch DML, 갱신 stored procedure/commit. Neo는 시각화 `NEXT_STEP*0..10`을 그대로 적용하여 20-edge 경로의 step 배열이 null, MySQL도 같은 반환 계약으로 맞춤. 동률 `path_id` 오름차순은 양쪽에 동일하게 추가한 평가용 결정성 규칙. SQL의 물리적 `depth` 메타데이터 저장과 Neo의 관계 탐색 차이는 남는다.
- 각 블록은 DB 한 개만 기동하여 **DB 1 CPU/3 GiB + Python worker 1 CPU/1 GiB**, localhost, 연결 재사용, Python 3.12, Neo4j 5.26.19·driver 5.28.2, MySQL 8.4.11·PyMySQL 1.1.2, Docker 29.8.1. FAISS는 공통 worker 이미지에 설치됐지만 본 실험에서 실행하지 않음. 외부 blog 컨테이너가 함께 동작한 공유 4 CPU 호스트. 블록 전후 1분 load 0.48–7.30, available memory 9.7–16.3 GB로 부하 변동이 있었음. 두 DB의 bind 경로 `/tmp/vowser-eval-v2`는 [`findmnt`/`df -T` 증거](results/storage-medium.json)에서 **tmpfs**로 확인됐다. 이는 메모리 기반 파일시스템 조건이며 영구 SSD의 I/O 지연을 대표하지 않는다. 지연은 **Python 드라이버, localhost 왕복, 결과 소비/정규화, commit 포함**이며 DB 엔진 내부 실행시간이 아니다. 단일 worker의 순차 처리량은 병렬 서비스 최대 QPS가 아니다.
- 조건별 고정 200연산을 각 블록에서 비측정 warmup 후 상태 reset하고 동일 trace로 측정. 3라운드, Neo→MySQL / MySQL→Neo / Neo→MySQL 순서, 매 블록 DB 재시작 후 인증 질의 준비. 90:10은 인기90·시각화90·등록10·갱신10, 50:50은 50·50·10·90. 측정 밖에 fixture·warmup·정합 readback/reset. worker **240초 guard는 준비 후 warmup·측정·검증을 포함하는 프로세스 제한**이며 요청별 timeout이 아니다. 사전 계획의 블록 3분과 전체 45분은 예상 운영 시간; host 상태 수집 수정·중단 복구를 포함한 총 수행 한도는 최초 측정 착수부터 75분으로 정했다. 공식 원시 CSV 첫 기록 06:27:34 UTC, 마지막 07:28:50 UTC.
- 계획과 인덱스: [MySQL 30k EXPLAIN](results/plans-uniform30k-mysql.json)은 인기 `ref`+`eq_ref`, 시각화 회원 `ref`·STEP `range`, 쓰기 PK/범위 접근. [Neo4j 30k EXPLAIN](results/plans-uniform30k-neo4j.json)은 인기/시각화 `NodeUniqueIndexSeek`, 갱신 `RelationshipIndexSeek`. 실행 계획은 `EXPLAIN`이며 실제 PROFILE 시간으로 표현하지 않음. [환경·이미지 digest·패키지 버전](../shared/environment-operations-end.json), [자원·파일 사용량 스냅숏](results/db-final-footprint.json) 보존. 마지막 tmpfs bind mount 파일 사용량은 MySQL 726 MB, Neo4j data 2.10 GB였으나 실험 순서에 따른 storefile 고수위가 포함되어 **동등한 fresh 30k 저장 효율이나 영구 디스크 성능 비교가 아니다**. tmpfs가 호스트 메모리 압박에 미친 영향은 따로 측정하지 않아 원인으로 단정하지 않는다.

## 전체 조건 결과

각 셀은 **MySQL p50/p95 → Neo4j p50/p95**, 단위 ms. 각 조건의 연산별 표본수는 인기·시각화 90:10에서 각 270, 50:50에서 각 150; 등록 30; 갱신 90:10에서 30, 50:50에서 270. 실패 0. 10k 쏠림은 사전 지정 진단이며 균등 조건의 반복이 아니다.

| 최종 경로·분포·읽기:쓰기 | 인기 | 시각화 | 등록 | 갱신 |
|---|---:|---:|---:|---:|
| 1k 균등 90:10 | 0.60/0.83 → 3.76/48.92 | 1.47/1.86 → 4.44/67.37 | 7.80/14.88 → 62.82/97.38 | 1.22/1.49 → 6.56/76.22 |
| 1k 균등 50:50 | 0.62/0.74 → 4.48/70.28 | 1.52/1.79 → 5.34/73.84 | 7.11/13.16 → 75.51/152.68 | 1.21/1.62 → 5.94/71.98 |
| 10k 균등 90:10 | 0.59/0.69 → 4.05/61.53 | 1.44/1.64 → 4.57/64.30 | 6.56/12.37 → 27.67/94.71 | 1.17/1.48 → 6.63/71.38 |
| 10k 균등 50:50 | 0.63/0.72 → 4.94/71.41 | 1.55/1.74 → 5.48/73.24 | 6.86/13.04 → 75.92/100.78 | 1.17/1.48 → 5.58/75.11 |
| 10k 쏠림 90:10 | 0.81/1.24 → 8.78/46.28 | 1.70/2.50 → 9.21/43.59 | 8.26/21.73 → 24.09/70.55 | 1.48/2.26 → 7.37/50.43 |
| 10k 쏠림 50:50 | 0.82/1.06 → 9.33/76.74 | 1.72/2.18 → 9.88/76.69 | 7.38/17.02 → 58.43/97.00 | 1.23/1.71 → 5.62/74.10 |
| 30k 균등 90:10 | 0.73/0.86 → 5.03/50.45 | 1.65/1.82 → 5.47/47.82 | 7.14/13.03 → 26.50/83.83 | 1.23/1.59 → 6.23/52.37 |
| 30k 균등 50:50 | 0.78/0.91 → 5.70/73.98 | 1.74/2.01 → 6.45/75.33 | 7.50/13.61 → 78.96/145.54 | 1.19/1.54 → 5.28/70.87 |

순차 200연산 블록 처리량(ops/s)은 아래 라운드 0/1/2 순서다. 초기 적재·기동·warmup·reset·검증은 제외한다.

| 조건 | MySQL r0/r1/r2 | Neo4j r0/r1/r2 |
|---|---:|---:|
| 1k 균등 90:10 | 623.4 / 709.0 / 710.8 | 80.0 / 83.8 / 77.3 |
| 1k 균등 50:50 | 673.9 / 671.3 / 617.4 | 54.2 / 54.7 / 52.8 |
| 10k 균등 90:10 | 730.7 / 727.7 / 714.3 | 84.4 / 81.6 / 95.6 |
| 10k 균등 50:50 | 673.4 / 664.5 / 672.7 | 59.8 / 54.9 / 59.7 |
| 10k 쏠림 90:10 | 574.2 / 655.0 / 478.8 | 83.1 / 83.5 / 71.0 |
| 10k 쏠림 50:50 | 605.2 / 546.5 / 633.3 | 50.5 / 48.4 / 48.8 |
| 30k 균등 90:10 | 629.4 / 635.6 / 622.4 | 97.8 / 95.6 / 81.7 |
| 30k 균등 50:50 | 597.7 / 624.4 / 602.0 | 57.9 / 52.5 / 52.3 |

라운드별 **각 연산** p50/p95 192행은 [per-round-metrics.json](results/per-round-metrics.json), 전체 64군은 [summary.json](results/summary.json), 블록별 처리량은 [throughput.json](results/throughput.json)에 보존. 시각화 3,360회(양쪽 합)는 모두 유효·null 경로가 함께 있는 top10이었다. 구성은 유효7/null3 2,820회, 6/4 438회, 8/2 102회이며 양쪽 구성/반환이 완전히 같음. 20-edge는 원본 `*0..10` 상한에 맞춰 null 반환; [구성별 지연](results/visualize-composition.json)에서 동일 구성 간 비교 가능하며 순수 all-valid/all-null 요청의 속도를 이 결과로 추정할 수 없다.

## 구현 진단과 신뢰 범위

Neo4j만의 1k 보조 진단에서는 깊이 5/10/20의 신규 등록 3건과 갱신 3건을 3회 측정했다(방식당 18쓰기). 원본형 DB 직접 구현은 깊이 d당 `2d+3` Cypher auto-commit, 최적 배치는 1회. 원본형→최적화 p50은 **등록 164.34→10.35 ms**, **갱신 96.71→7.55 ms**(p95 등록 211.60→61.06, 갱신 179.61→73.53 ms). [원시 기록](results/source-diagnostic-source_shape.csv)·[최적화 기록](results/source-diagnostic-optimized.csv)과 상태 검증 JSON을 보존. 임베딩 생성/원본 API 호출은 제외했으므로 이 수치를 실제 전체 등록 API 개선률로 해석하지 않는다.

공식 결과는 **48완료 블록·9,600 timed 요청·9,600 비측정 warmup 요청**, 전부 정답이다. 각 요청 반환 payload를 oracle과 비교했고, 모든 블록의 완료 가중치/경량 상태와 reset 상태를 확인했다. ROOT/HAS/STEP/EDGE 전체 readback checksum은 **8개 조건의 마지막 r2 양DB 쌍**에서 일치했다. 별도 smoke는 양쪽 각 200연산을 메타데이터 보정 전후 두 차례씩 실행해 총 800 비측정 요청; 최초 smoke JSON은 덮어썼고 로그에 네 PASS가 남았다. 원본형/최적화 진단은 각 18 timed+18 비측정 쓰기. **별도 중단 시도** 10k 균등 50:50 Neo4j r2는 warmup 200과 timed CSV 200정답까지 진행했으나 최종 전수 검증/reset 전 호스트 셸 SIGTERM 종료코드143을 관측했다. 원인은 미확정이며 worker 240초 guard/DB OOM으로 단정하지 않는다. [중단 CSV](results/interrupted-uniform-10000-50_50-neo4j-r2.csv)·[관측 시간/조치](results/interrupted-uniform-10000-50_50-neo4j-r2.json)를 **9,600 공식 표본에서 제외**하고 같은 초기 fixture/고정 trace로 해당 블록만 재측정해 완전 검증했다. 완료한 다른 블록은 재실행하지 않았다. 진단까지 포함해 보존된 timed 시도는 9,836회(공식9,600+중단200+보조36)이며 성공한 공식 표본을 선택해 결과를 바꾸지 않았다.

첫 공식 timed 요청 전에 `run_case.sh` 실행 권한 호출, EXPLAIN plan 자료형, smoke attempted_ops 표기, host 메모리 수집 의존성을 수정했다. 마지막 host 수집 수정은 첫 유효 timed 요청 전에 이뤄졌으나 최초 smoke freeze 뒤이므로 [수정 시각/해시](freeze-main-v2.json)와 [수정 목록](smoke_fixes.json)을 분리했다. 입력·질의·자원 한도는 수정하지 않았다. [사후 freeze 감사](results/final-freeze-audit.json)는 당시 입력/질의 소스와 현재 SHA 일치, [전수 사후 감사](results/audit.json)는 trace/oracle SHA, 24개 블록 쌍의 경량 상태와 8개 마지막 라운드 쌍의 전체 payload checksum, 모든 warmup/reset/200행을 확인했다. 실험 종료 시 전용 Neo4j 컨테이너의 Docker 종료코드는 137이었지만 `OOMKilled=false`였고, [상태 기록](results/db-lease-return.json)에는 정지 상태를 보존했다. 이 종료코드를 적재/측정 OOM으로 세지 않았다. CPU와 DB 캐시·공유 호스트 부하, PyMySQL의 연결 내 암묵 읽기 트랜잭션과 Neo 작업별 auto-commit 차이, SQL의 depth 메타데이터 때문에 순수 DB 엔진 일반 우열로 확대할 수 없다.

## 재현 자료

`operations/PROTOCOL.md`·`trace_manifest.json`·`traces/`에 사전 조건, 8개 trace/oracle SHA 보존. **기존 결과가 덮어쓰이지 않도록 이 실험 폴더를 별도 새 디렉터리로 복제한 전용 환경에서만 재실행**한다. `shared/setup.sh`와 `shared/recreate_db.sh`는 이름이 고정된 전용 v2 DB를 구성/초기화하므로 다른 실험이 그 DB를 사용하지 않는지도 먼저 확인한다. 새 디렉터리에서 `bash shared/setup.sh` 후 `bash operations/run_case.sh prepare neo4j 1000`, `bash operations/run_case.sh prepare mysql 1000`으로 fixture를 만들고, `bash operations/run_case.sh round neo4j 1000 90:10 0 uniform` 등 PROTOCOL의 교차 순서를 실행한다. 원시 CSV/블록 JSON/host-before·after는 `operations/results/`·`operations/runs/`에 모두 보존. DB 접속 비밀은 저장소 밖 `/tmp/vowser-eval-v2/credentials.env`(0600)이며 보고서에 값 없음. 사후 재집계는 `python3 operations/analyze.py`; 도구 버전/이미지 digest는 `shared/environment-operations-end.json`. 실험 2 증거 저장 후 전용 DB를 종료하고 후속 실험용으로 재생성했으므로 현재 데이터는 재현 입력의 영구 백업이 아니며 deterministic generator와 raw 기록이 근거다.
