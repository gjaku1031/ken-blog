# Vowser 경로 저장소 재평가: Neo4j와 MySQL (2026-09-28~29)

분류: 탐색적 실험. 데이터·자원·실행 순서·정답 확인 절차는 실행 전에 프로토콜로 정했지만(`shared/CONTRACT.md`, `search/PROTOCOL.md`, `branching/PROTOCOL.md`), 어느 DB가 빠를지에 대한 가설과 판정 기준은 미리 정하지 않음.

| 디렉터리 | 내용 |
| --- | --- |
| `shared/` | 공통 자원·데이터 계약, 합성 데이터 생성, 환경 기록 |
| `operations/` | Q1 운영 연산(등록·인기·시각화·가중치) 비교의 실행 코드·고정 기록·보고 |
| `search/` | Q2 의도 검색(MySQL+FAISS, Neo4j 원본형·개선형) 프로토콜·고정 해시·보고. 중단된 v1·v2 고정 기록도 보존 |
| `branching/`, `branching-revised/`, `branching-diagnostic/` | Q3 공유 단계·분기 경로 프로토타입. 첫 측정에서 MySQL 소속 테이블 방식의 조인 순서 문제가 드러나 보정한 별도 코호트(`branching-revised`)와 진단 기록 |
| `summary/` | 통합 보고서, 운영 결과 독립 감사, 분기 방법 변경 기록 |

요청별 원자료(약 600MB)는 크기 때문에 저장소에 넣지 않음. 집계·감사 결과와 고정 해시로 대신함. 측정 환경은 공유 VM, DB 컨테이너 1 CPU·3GiB, worker 1 CPU·1GiB, tmpfs 저장.
