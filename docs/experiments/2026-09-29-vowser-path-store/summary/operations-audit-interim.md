# 운영 실험 1천·1만 경로 원시자료 독립 감사

범위: 균등 1천·1만, 편중 1만 × 읽기:쓰기 90:10·50:50 × MySQL/Neo4j × 3회. **3만 경로 본측정 진행 중이므로 이 파일은 중간 감사이며 최종 비교 결론이 아님.**

- 공식 완료 블록 36개, 요청 **7,200회**. CSV 각 200행·순번 0–199, 요청 정합 7,200/7,200, 오류·timeout **0회**. 별도 비측정 warmup도 36×200 = **7,200회**이며 원시 지연 분모에서 제외.
- 각 블록의 최초 상태 = warmup 후 reset = 측정 후 reset. 같은 trace의 warmup 최종 상태 = 측정 최종 상태. 여섯 조건 모두 여섯 블록의 최종 경로·가중치·방문 수 스냅숏 일치, 마지막 라운드의 MySQL/Neo4j 전체 ROOT/HAS_STEP/STEP/NEXT_STEP SHA readback 일치.
- 균등 1만·50:50 Neo4j r2의 앞선 시도는 CSV **200행 기록 후**, 최종 전체 readback·reset 전에 **host shell SIGTERM(exit 143)**으로 중단. [중단 증거](../operations/results/interrupted-uniform-10000-50_50-neo4j-r2.json)와 원시 CSV를 보존했고 공식 7,200회 및 지연 집계에서 제외. 같은 조건을 fresh fixture에서 완료한 공식 r2만 포함. 이는 요청 timeout 200건이 아님.
- 원본 단계별 Neo4j 호출과 단일 Cypher 최적화의 [보조 진단](../operations/results/source-diagnostic-source_shape.json)은 각 **18회, 합계 36회**로 주 MySQL↔Neo4j 비교에 합치지 않음. 호출·트랜잭션 경계가 다른 진단임.
- 연산별 독립 재계산은 [CSV](operations-audit-interim.csv)의 `median_ms`와 선형 보간 Type-7 `p95_ms_type7`에 있음. [JSON](operations-audit-interim.json)은 블록·trace SHA·원자료 SHA와 전체 검증 내용을 보존. 3만 경로 종료 후 모든 조건을 다시 집계해야 함.

측정 VM은 기존 서비스 컨테이너가 유지된 공유 호스트이므로 DB·worker 상한은 지켜도 유휴 호스트 상태는 보장되지 않음. 작은 지연 차이와 긴 꼬리 지연은 이 한계를 고려해 해석.
