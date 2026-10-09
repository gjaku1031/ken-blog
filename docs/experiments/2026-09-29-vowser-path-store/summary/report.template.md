# Vowser 저장·탐색 경로 재평가 — 세 실험 통합 요약

측정일: {{UTC_DATE}} · 원본 코드 기준: {{SOURCE_REVISION}} · 판정: {{OVERALL_CONCLUSION}}

이번 평가는 같은 생성 경로와 정답을 사용해 현재 제품의 **의도 후보 검색→전체 경로 반환**과 **경로 등록·가중치·인기/시각화 운영**, 별도 프로토타입인 **공유 STEP·분기/대체 경로 탐색**을 각각 검증함. 현재 제품에 없는 분기 모델의 수치를 현행 성능 근거로 사용하지 않음.

| 실험 | 현재 제품과의 관계 | 비교·입력 | 관측 결과와 판단 |
|---|---|---|---|
| 1. 의도 검색 후 경로 복원 | 현행 ROOT/STEP/HAS_STEP/NEXT_STEP, 1536차원 합성 벡터 | 1k/10k/30k, uniform/skew, Neo4j vector index와 MySQL+동일 worker FAISS; top-k 정합·recall·p50/p95·메모리 | {{SEARCH_RESULT}} |
| 2. 등록·가중치·운영 조회 | 현행 관계·단계 연산의 DB 직접 투영. 임베딩 저장·API 호출 제외 | 최종 경로 1k/10k/30k, 깊이 5/10/20, read:write 90:10·50:50, Neo4j batch와 색인된 MySQL; 동일 payload·최종 weight oracle | {{OPERATIONS_RESULT}} |
| 3. 공유 STEP·분기 | **미구현 확장 프로토타입** | {{BRANCH_CONDITIONS}} | {{BRANCH_RESULT}} |

{{CROSS_EXPERIMENT_INTERPRETATION}}

측정 경계: 각 비교군의 DB 1 CPU/3 GiB와 Python worker 1 CPU/1 GiB(총 2 CPU/4 GiB). DB는 단독 기동하며 같은 trace를 교차 순서로 실행. 준비·적재·warmup·reset·정합 검증은 요청 지연에서 제외. 기록된 지연은 드라이버·localhost 통신·결과 구성 포함, 순수 DB 엔진 시간 아님. 호스트 공유 부하, 합성 데이터와 모델 범위를 함께 고려해야 함. {{LIMITATIONS}}

원자료와 재현: [공통 계약](../shared/CONTRACT.md) · [환경](../shared/environment.json) · [실험 1](../search/) · [실험 2](../operations/) · [실험 3](../branching/) · {{RAW_LINKS}}
