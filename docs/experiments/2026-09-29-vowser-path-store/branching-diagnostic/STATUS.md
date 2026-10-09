# 미실행 사후 단독군

2026-09-29: `mysql_member_ordered` 단독 20셀 진단은 SQL·worker·host·감사 코드의 준비 및 정적 검사까지만 수행했다. 입력 manifest는 만들지 않았고 DB 접속·적재·질의·측정은 **0회**다. 원본 분기 실험 1만 경로 셀에서 비효율적인 MySQL membership 조인 계획이 확인된 뒤, 이 단독군 대신 [`branching-revised/`](../branching-revised/)에서 MySQL 인접 탐색·수정 membership과 Neo4j 인접 탐색·membership 네 군을 같은 새 cohort로 재측정하기로 변경했다. 원본 분기 실험의 완료·부분 시도 자료는 별도로 보존한다. 이 폴더의 코드나 설계로 성능·정확도 결과를 주장하지 않는다.
