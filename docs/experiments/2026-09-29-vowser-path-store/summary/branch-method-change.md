# 분기 실험의 사후 설계변경 기록

공유 STEP·분기 경로는 현재 Vowser에 없는 프로토타입이다. 최초 [`branching/PROTOCOL.md`](../branching/PROTOCOL.md)의 네 군 비교는 1천 경로 9셀의 공식 본측정 **21,600건**과 같은 수의 예열을 완료했다. 이후 첫 1만 경로 셀에서 60분 상한에 도달했고, 이어 실행도 분석 결정으로 중단했다. 두 부분 CSV에는 파싱 가능한 행 **549개와 548개**가 각각 남았다. 이는 발행 시도 수의 **하한**이며 완주 블록의 공식 측정 분모에 넣지 않는다([중단·SHA 증거](../branching/results/analyst-stop-evidence.json)). 최초 9셀의 원시자료와 실행계획은 [`branching/results/`](../branching/results/)에 보존했다.

최초 MySQL membership의 바깥 조인에서 `br3_member`가 적격 경로 3개보다 먼저 `condition_id`의 회원행을 훑는 계획이 관측됐다. 첫 1천 경로 셀의 추정 선행 조회는 약 **6,330행**이었다([EXPLAIN](../branching/results/n1000-s0-b1/plans-mysql.json)). 첫 1만 경로 셀의 부분 예열 149건에서는 membership 정답 응답 p50이 **759.549ms**였지만, 이 불완전 표본을 공식 결과나 모든 1만 경로 조건의 예측으로 사용하지 않는다. 이 계획 아래 Neo4j와의 지연 차이는 최적 SQL 기준선에 대한 엔진 우위로 해석할 수 없다.

원본 결과를 수정하거나 새 결과에 합치지 않고, [`branching-revised/PROTOCOL.md`](../branching-revised/PROTOCOL.md)의 **새 20셀 네 군 cohort**를 사후 설계변경으로 분리했다. 변경 SQL은 원본 MySQL membership의 바깥 `SELECT`에 `STRAIGHT_JOIN` 한 곳을 추가한다. MySQL 인접 탐색과 Neo4j 두 군, 생성 경로·질의·오라클·전체 반환 필드·자원 상한은 유지한다. 새 20셀은 기본 16셀과 50/100연결 한계 4셀을 모두 포함하며, 셀마다 네 군 각각 3라운드×200건을 본측정했다. 공식 **48,000/48,000건 정답·본측정 timeout 0**이며, 비측정 warmup Neo timeout 111건은 별도다. 기본/한계와 모든 군의 p50·p95는 [교정 코호트 보고서](../branching-revised/report.md), 원시 검산은 [독립 감사](../operations/branching-revised-audit.json)에 보존했다. 해당 cohort는 최초 결과를 보고 결정된 보정이므로 최초 사전 동결 결과로 소급하지 않는다.

별도로 준비했던 [`branching-diagnostic/`](../branching-diagnostic/STATUS.md)의 ordered-only 20셀 단독군은 코드 정적 검사까지만 했고 **DB 적재·질의·측정 0회**다. 새 네 군 cohort로 대체되었다.
