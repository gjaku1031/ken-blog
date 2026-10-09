# 사후 진단 설계: MySQL membership 조인 순서

**상태: 실행 계획 대체로 미실행.** 이 별도 `mysql_member_ordered` 단독군은 코드와 정적 검사까지만 준비했고 DB 적재·질의·본측정·입력 manifest 생성은 하지 않았다. 2026-09-29 원본 분기 실험이 1만 경로의 느린 MySQL 조인 계획 때문에 60분 상한에 걸린 뒤, 원본 원시자료를 보존하면서 네 군 전체를 새 cohort에서 재측정하는 [`branching-revised/`](../branching-revised/) 계획으로 대체되었다. 아래 내용은 당시 검토한 **실행되지 않은 설계 기록**이며 새 cohort의 결과·사전 계획으로 읽지 않는다. 원래 16개 기본 셀과 4개 stress 셀의 원시 결과·코드·순위는 이 파일 때문에 바뀌지 않는다.

## 발견과 검증할 가설

현재 `branching/storage.py`의 `SQL_MEMBERSHIP`은 `eligible` CTE에서 문맥·차단 조건을 만족하는 Top3 경로를 고른 뒤, `br3_member`와 `br3_step`을 조인한다. 그러나 첫 완료 셀 `n1000-s0-b1`의 [MySQL EXPLAIN](../branching/results/n1000-s0-b1/plans-mysql.json)은 바깥 조인에서 `m`을 먼저 읽으며 `PRIMARY`의 `condition_id` 부분만 사용해 약 **6,330행**을 조사하고, 물질화된 `e`의 3개 경로를 뒤에 붙인다. 차단 검사 내부의 `br3_member_step` 인덱스 사용과 바깥 복원 조인의 비효율은 별개다. 관측된 첫 셀의 MySQL membership p50 약 58ms 대 Neo4j membership 약 5ms를 **최적 SQL 대비 DB 엔진 우위**로 해석할 수 없다. 다른 셀에도 같은 계획이 반복되는지는 각 셀의 원래 EXPLAIN으로 확인한다.

검증 가설은 **적격 경로를 바깥 조인의 첫 입력으로 강제하면 동일 반환 계약에서 회원행 복원의 스캔 범위와 지연이 줄 수 있다**는 것이다. 이는 아직 측정 결과가 아니다. MySQL 8.4 문서는 `SELECT STRAIGHT_JOIN`이 FROM 순서대로 조인하도록 하며, `LIMIT`가 있는 CTE는 병합되지 않는다고 설명한다. 힌트 `JOIN_ORDER`는 적용이 무시될 수 있으므로 첫 진단은 `STRAIGHT_JOIN` 한 가지로 고정한다. [MySQL SELECT](https://dev.mysql.com/doc/refman/8.4/en/select.html), [CTE 물질화](https://dev.mysql.com/doc/refman/8.4/en/derived-table-optimization.html), [조인 순서 힌트](https://dev.mysql.com/doc/refman/8.4/en/optimizer-hints.html).

## 단일 쿼리 수정안

원래 `SQL_ELIGIBLE` 문자열과 parameter 순서, `ORDER BY p.depth,p.path_id LIMIT 3`, 차단 `NOT EXISTS`, 외부 반환 필드·정렬을 그대로 가져온다. 바깥 `SELECT`에만 `STRAIGHT_JOIN`을 추가한다. 새 인덱스, 스키마, 적격 경로 선정식, JSON payload, 결과 정렬은 변경하지 않는다.

```sql
WITH eligible AS (
  -- 원본 branching.storage.SQL_ELIGIBLE을 그대로 삽입
)
SELECT STRAIGHT_JOIN
  e.path_id,e.domain,e.intent,e.auth,e.depth,m.ordinal,
  s.step_id,s.url,s.action,s.selector,s.description
FROM eligible e
JOIN br3_member m ON m.condition_id=%s AND m.path_id=e.path_id
JOIN br3_step s ON s.condition_id=m.condition_id AND s.step_id=m.step_id
ORDER BY e.depth,e.path_id,m.ordinal;
```

원래 `mysql_member`와 같은 parameter tuple `(cell,domain,intent,auth,*blocked,cell)`을 사용한다. Python 필드 정규화와 canonical JSON 직렬화까지 원래 `branching.bench.run_one`과 같은 타이머 경계에 넣고, SHA·오라클 판정은 타이머 밖에 둔다. 개별 쿼리 `MAX_EXECUTION_TIME=2000`과 오류 뒤 연결 재생성도 원래 MySQL worker 계약과 같다.

**실행계획 합격 조건:** 답이 세 경로인 고정 사례에서 `EXPLAIN FORMAT=JSON`의 바깥 nested loop가 물질화된 `eligible e` → `br3_member m` → `br3_step s` 순서여야 한다. `m`은 `(condition_id,path_id)`를 앞부분으로 사용하는 `PRIMARY` 또는 `br3_member_path_step`의 `ref` 접근, `s`는 `(condition_id,step_id)`의 `PRIMARY` `eq_ref` 접근을 기대한다. `m`이 여전히 condition_id만으로 전체 셀을 선행 스캔하거나 힌트가 무시되면 보정 성공으로 보지 않고 실제 계획·오류를 그대로 보고한다. `EXPLAIN`은 지연 측정 밖에서 각 셀 대표 정상 대체·무응답 사례에 실행한다. 반환 SHA와 차단·ordinal·경로 오염·전체 필드 검증이 원래 oracle과 같아야 한다.

## 원본 20셀을 그대로 쓰는 전체 진단

1. 원래 분기 기본 16셀과 stress 4셀 모두 본측정·증거 수집이 완료된 뒤 전용 v2 DB의 배타적 사용권을 받는다. 원래 첫 실행의 `complete` 또는 원래 상태를 보존한 채 진행한 유효한 `continuation-*.json`의 `complete`를 인정하되, **20셀 전체의 input/expected·6개 블록·합본 raw를 다시 검산**한다. 새 `branching-diagnostic/` 결과 디렉터리만 기록하며 원래 `branching/`의 동결 코드·입력·oracle·원시 CSV/JSON은 읽기 전용으로 유지한다. 원본 코드 SHA, `input.json`·`expected.jsonl` SHA, 환경 이미지/자원, 신규 SQL 및 runner SHA를 **사후 진단 manifest**에 별도로 고정한다. 원본 20셀 중 하나라도 미완료 또는 입력/정답 누락이면 이 진단을 시작하지 않는다.
2. 원본 `branching.model.CELLS`의 기본 **16셀**과 `STRESS_CELLS`의 **4셀**을 같은 순서로 사용한다. 원본 `Model`을 import해 경로·질의를 구성하되 저장된 각 셀의 `input.json` cases 및 `expected.jsonl` 전체 SHA와 대조한다. 진단 자체는 MySQL만 사용하지만 원본과 같이 DB 컨테이너 **1 CPU/3 GiB**, worker 컨테이너 **1 CPU/1 GiB**, 한 DB만 활성화, 같은 적재·인덱스·필드 계약을 유지한다. 이 값은 컨테이너별 설정 상한이며 tmpfs·다른 서비스를 포함한 공유 호스트 전체 물리 RAM 상한이 아니다. 새 부팅·fixture 적재·인덱스 구축·계획 수집은 응답 타이머 밖에 보존한다.
3. 셀마다 **3라운드**, 라운드마다 같은 **200개 질의 warmup + 200개 측정**을 새 `mysql_member_ordered`에 실행한다. 즉 20셀의 warmup **12,000회**, 측정 **12,000회**. 측정 전 셀별 원본 200사례 전체 payload를 한 번 실행하는 smoke 총 **4,000회**는 별도 분모로 기록한다. 원본처럼 라운드별 DB 준비·인증을 확인하고 동일 query ID/순서·시나리오·차단 목록을 사용한다. timeout·오답·오류는 각 셀 **600회 측정 분모**에 유지하고 성공 요청의 p50/p95만 따로 계산한다. 셀별 `alternate/none/auth_block`과 깊이·차단 수별 정합·지연도 분리한다. 기본/한계 두 군의 60분 상한은 완료 보증이 아니라 상한이다. 미완료 셀은 미완료로 기록하며 임의 삭제하지 않는다.
4. 비교표는 (a) 원래 네 군의 **사전 고정 결과**, (b) 사후 `mysql_member_ordered`를 열로 분리한다. 원래 MySQL membership과 새 군의 실행 시점이 다르므로 저장된 과거 지연과의 차이는 서술적 비교다. Neo4j 대 새 SQL의 순위 역시 원래 원시 결과의 대체가 아니라 사후 민감도 분석이다. 물리 볼륨을 재생성했다면 캐시·storefile 상태 차이도 명시한다. 전용 DB bind 경로 `/tmp/vowser-eval-v2`는 이 VM의 **tmpfs** 위에 있으며 SSD 기반 운영 저장소의 지연·용량을 대표하지 않는다([저장매체 증거](../operations/results/storage-medium.json)).

## 작은 진단의 선택지

아래는 실행시간 판단 때 검토한 **미채택 축소안**이다. 먼저 `n1000-s0-b1`의 대표 정상 대체·무응답 입력에서 계획과 payload만 검사하면 **조인 순서 가설**을 짧게 판별할 수 있지만 속도나 20셀 일반화는 할 수 없다. 측정까지 필요한 최소 세 셀은 입력 구조를 결과 보고 선택하지 않도록 **사전 지정**한다: `n1000-s0-b1`(현재 관측 결함), `n10000-s50-b4`(기본 최대 규모·공유/분기), `n1000-d100-s50-b4`(긴 경로 한계). 이 세 셀도 각 3라운드×200 warmup+200 측정, 즉 추가군 **1,800 측정·1,800 warmup**을 유지한다. 결함의 인과 확인을 더 강화하려면 같은 세 셀에서 원래 `mysql_member`를 변형 없이 **동시 재측정**하고 두 SQL의 블록 순서를 라운드별 AB/BA로 교차한다. 그러면 군당 1,800 measured/warmup, 두 군 합계 **7,200요청**이 되며 원래 네 군 결과와는 별도로 표기한다. 이 축소안은 모든 20셀에서 보정 SQL이 빠르다고 주장할 근거가 될 수 없다.

당초 승인됐으나 실행되지 않은 전체 20셀 ordered-only 안은 **24,000 warmup·본측정 요청 + 4,000 별도 smoke + 20회 적재 + 셀당 4회 DB 기동**이었다. 세 셀 paired 축소안도 실행하지 않았다. 첫 셀의 기존 느린 SQL 약 58ms나 새 SQL의 예상 개선을 미래 실행시간으로 외삽하지 않는다. 실제 소요는 적재·재시작·timeout과 공유 VM 부하에 따라 달라질 수 있다. 원래 실험의 총시간·품질·비교군 순위는 이 미실행 계획으로 바꾸지 않는다.

## 실행·재현 절차

아래는 **실행하지 않은 재현 초안**이다. 당시에는 원본 20셀 종료와 부모의 명시적 DB lease 후 `PYTHONPATH=experiments/2026-09-29 python3 experiments/2026-09-29/branching-diagnostic/manifest.py create`로 기존 파일 40개와 원본/신규 코드 해시를 고정하고, `cd experiments/2026-09-29 && bash branching-diagnostic/managed.sh start main` 다음 `start stress`를 계획했다. 이 명령들은 새 cohort로 대체되어 호출하지 않았다. PID/start tick 관리, 3,600초 watchdog, 20셀×600건 감사 코드는 정적 검사만 했고 실행 결과가 없다.
