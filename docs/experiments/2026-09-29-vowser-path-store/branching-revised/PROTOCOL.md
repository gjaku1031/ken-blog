# 실험 3 교정 코호트: 현재 Vowser에 없는 공유 STEP·분기 대체 경로

상태: 본측정 전 사전 고정. 2026-09-29 최초 `branching/` 코호트는 MySQL membership outer join이 `br3_member`를 먼저 스캔하는 계획을 뒤늦게 발견하여 1,000경로 9셀 완료와 10,000경로 부분 시도만 **원본 증거로 보존**했다. 최초 60분 종료와 이어 실행의 분석자 중단은 `branching/results/run-status.json`, `continuation-main-cont01.json`, `analyst-stop-evidence.json`에 구분되어 있다. 이 코호트는 첫 결과를 고르거나 이어 붙이지 않고 아래 20셀 전체를 새 DB·새 결과 경로에서 다시 측정한다. 이 기능은 현재 Vowser 제품에 구현되지 않은 DB 프로토타입이다.

## 비교 계약

`branching/model.py`와 `shared/data.py`의 seed 20260929, 경로·STEP·path membership·blocked 목록·독립 오라클을 그대로 사용한다. 기본 16셀은 1k의 공유 0/25/50%×분기상한 1/2/4(9셀), 10k의 `(0%,1)` 및 25/50%×1/2/4(7셀). 각 셀은 깊이 5/10/20 균등. 별도 한계 4셀은 1k 고정깊이 50/100×`(0%,1)`·`(50%,4)`이며 제품 최대 20을 넘는 확장 조건이다. 한 셀의 `N`은 **전체 등록 경로 수**다. 공유율은 재사용된 path-STEP 소속 건수/전체 소속 건수, 압축률은 `1-고유 STEP 수/전체 소속 건수`; 실제 degree·두 비율은 입력 통계에 기록한다. 공유0%·상한2/4는 실제 degree1일 수 있고, 10k 공유0%×상한2/4 상호작용은 측정하지 않는다.

같은 도메인·투영 의도·인증 상태에서 막힌 STEP이 없는 **완주한 등록 경로**를 연결 수/path ID 오름차순 top3로 반환한다. 200고정질의/셀은 대체경로 160(목표 깊이 5/10/20 각각 54/53/53), 모두 막힘 20, 인증 차단 20이다. 깊은 사례는 blocker 수도 늘어 깊이만의 순수 효과로 해석하지 않는다. 네 군은 `neo_adj`(원본 Neo QPP+pathId·ordinal 조기 제약), `mysql_adj`(원본 indexed adjacency CTE), `neo_member`(원본 path membership), `mysql_member_ordered`(원본 indexed membership **바깥 SELECT에만 `STRAIGHT_JOIN` 추가**)이다. 기존 `branching.bench.run_one`의 경계(문맥 root 조회→전체 필드 canonical JSON 생성)를 네 군 모두 공유하고 SHA·오답 판정은 타이머 밖이다. 기존 모델·DB loader·세 원본 질의·2초 query timeout을 변경하지 않는다. ordered 군 SQL의 역치환 결과가 원본 `mysql_member`와 byte-for-byte 같아야 한다.

MySQL ordered 군은 본측정 전에 EXPLAIN JSON 원문을 저장하고 대표 정답3경로 조건에서 outer join 순서 `e→m→s`, `e` materialized, `m`은 `(condition_id,path_id)` ref, `s`는 `(condition_id,step_id)` eq_ref PRIMARY를 모두 확인한다. 실패하면 튜닝·측정을 중단한다. base720 전체 문맥·source 대체 및 none/auth 840사례×4군=3,360 요청과 depth100 360경로 고정200질의×4군=800요청을 비측정 스모크로 먼저 검증한다. 적재 후 각 엔진의 전체 경로 소속·STEP payload를 독립 원장과 전량 비교하며 NodeIndexSeek·VarLengthExpand 계획도 보존한다.

각 셀은 MySQL 단독 적재·전량 검증→정지, Neo4j 단독 적재·전량 검증→정지 후 round0 MySQL→Neo, round1 Neo→MySQL, round2 MySQL→Neo를 수행한다. DB 재시작 블록마다 해당 엔진의 두 모드를 각각 200회 warmup 후 200회 본측정한다. DB 내 모드 순서는 round마다 역전한다. 기본16셀 warmup 38,400+본측정38,400=`76,800` 요청, 별도 stress4셀 9,600+9,600=`19,200` 요청. timeout·오답·오류도 발행한 본측정 시도 분모에 남기며 정답 응답 p50/p95와 성공률을 함께 표시한다. `complete`는 800행/블록·4,800행/셀 완주이지 전 요청 정답이라는 뜻이 아니다. 불완전 블록의 flush된 CSV는 **발행 시도 수의 하한**이며 공식 완주 분모에 합치지 않는다.

DB 한 대만 활성화하며 각 DB 1 CPU/3 GiB, worker 1 CPU/1 GiB. TCP ready 뒤 인증 `SELECT 1`/`RETURN 1`을 최대90초 재시도한다. DB·worker 준비, 적재, INDEX/PROFILE, 원장 검증, warmup은 개별 본측정 지연 밖이다. 본16셀과 stress4셀은 각 그룹/attempt 60분 watchdog을 두며 도구 세션에서 분리된 PID·로그로 관리한다. 상한에 닿으면 완주 셀·블록만 보존/skip, 부분 원시자료는 SHA·행 하한으로 별도 archive하고 **미완료 블록 전체 warmup+measure만** 같은 조건으로 재개한다. 완료 블록의 정답/오류 구성을 보고 성공만 골라 재측정하지 않는다. DB 물리 저장소는 공용 `/tmp` tmpfs(`operations/results/storage-medium.json`)이므로 영구 SSD 운영 속도·비용으로 외삽하지 않는다. 제품 API/브라우저/LLM/음성/실제 인증·결제는 범위 밖이다.

`results/freeze.json`은 새 프로토콜·스크립트, 원본 `branching/` 실행 9파일, shared generator/client 및 제품 원본 SHA·HEAD를 최초 실행 전에 동결한다. 셀마다 새 `input.json`·`expected.jsonl`과 SHA를 기록하고 원래 코호트에 동일 입력이 있는 셀은 byte SHA도 대조한다. 모든 성능 raw·plan·적재 검증·환경·중단 기록은 `branching-revised/results/`에만 쓴다. 재현은 fresh 전용 DB와 별도 출력 복제본에서 실행하며 기존 증거 경로를 덮어쓰지 않는다.
