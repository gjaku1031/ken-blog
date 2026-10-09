# 운영 실험 전체 원시자료 독립 감사

범위: 균등 1천·1만·3만 경로, 편중 1만 경로 × 읽기:쓰기 90:10·50:50 × MySQL/Neo4j × 3회. [감사 스크립트](audit_operations.py)는 운영 폴더를 읽기 전용으로 검사하며, 연산별 값은 [CSV](operations-audit-final.csv), 파일별 SHA와 블록별 정합은 [JSON](operations-audit-final.json)에 보존.

| 구분 | 확인 결과 |
|---|---|
| 공식 측정 | 48블록 × 200 = **9,600요청**, CSV 순번·trace·operation 구성 확인. 정합 **9,600/9,600**, 요청 오류·timeout **0**. |
| 비측정 warmup | 48블록 × 200 = **9,600회**, 원시 측정 지연에 포함하지 않음. |
| reset·oracle | 모든 블록의 시작 상태 = warmup 후 reset = 측정 후 reset. 동일 trace의 warmup 최종 상태 = 측정 최종 상태. 여덟 조건별 6블록의 최종 가중치·방문 수 스냅숏과 마지막 라운드의 양 DB ROOT/HAS_STEP/STEP/NEXT_STEP 전체 SHA readback 일치. |
| 중단 시도 | 균등 1만·50:50 Neo4j r2의 이전 CSV **200행**은 전체 readback·reset 전 호스트 shell **SIGTERM exit 143**으로 중단. [증거](../operations/results/interrupted-uniform-10000-50_50-neo4j-r2.json) 보존. 공식 분모와 지연 통계에서 제외했고, 요청 timeout 200건으로 계산하지 않음. |
| 원본형 보조 진단 | 단계별 Neo4j 호출 18회와 단일 Cypher 최적화 18회, 합계 **36회**. 두 모드의 최종·reset 상태는 일치하지만 호출·트랜잭션 경계가 다르므로 주 MySQL↔Neo4j 비교에서 제외. |

동일 조건·연산으로 짝지은 **32개 연산군에서 MySQL의 중앙값과 p95가 각각 모두 낮았다(32/32)**. 예를 들어 균등 3만 경로·90:10의 중앙값(ms)은 인기 조회 **0.731 대 5.029**, 시각화 **1.651 대 5.471**, 신규 등록 **7.144 대 26.497**, 가중치 갱신 **1.234 대 6.232**(MySQL 대 Neo4j). 전체 조건별 값과 원시 분모는 CSV에 있으며, p95는 원시 `latency_ns`를 ms로 바꿔 선형 보간 Type-7으로 재계산했다. 이는 이 구현·자원·합성 trace의 단일 클라이언트 결과이며 원본 API 전체 처리시간 또는 순수 DB 엔진 지연이 아니다.

운영 비교는 MySQL의 PK/FK·도메인/가중치·경로/순서 인덱스와 batch/프로시저, Neo4j의 단일 Cypher·UNWIND batch를 사용한다. MySQL 연결의 암묵 읽기 트랜잭션 범위와 Neo4j 작업별 auto-commit 경계가 다르며, 한쪽을 의도적으로 미색인 상태로 두지 않았다. 기존 ken-blog API/web·devspace가 함께 실행된 VM에서 별도 서비스 재기동도 관찰되어 호스트 유휴는 보장되지 않는다. 긴 꼬리 지연과 작은 차이를 다른 배치·하드웨어로 일반화하지 않는다.
