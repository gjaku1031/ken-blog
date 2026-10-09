# 전용 v2 평가 환경 정리 계획 (실행 전 확인용)

**현재 미실행.** 교정 분기 코호트의 본16셀·한계4셀, 중단/재개 증거, DB 의존 count·EXPLAIN·환경 스냅숏, 원시 CSV와 보고서의 최종 SHA를 먼저 보존한 뒤 실행한다. `branching-revised/managed.sh status` 등 모든 평가 runner가 종료됐는지 확인한다. 실행 중인 runner나 아직 필요한 DB 증거가 있으면 정리하지 않는다.

1. `docker ps -a`에서 대상 **정확한 이름**과 `vowser.eval=2026-09-29` 라벨을 확인한다. DB 두 개 `vowser-eval-v2-mysql`, `vowser-eval-v2-neo4j`의 역할 라벨이 각각 `mysql`, `neo4j`이고 bind 원본이 `/tmp/vowser-eval-v2/mysql`, `/tmp/vowser-eval-v2/neo4j/data`, `/tmp/vowser-eval-v2/neo4j/logs`인지 확인한다. 남아 있는 평가 worker `vowser-eval-v2-br3-revised`, `vowser-eval-v2-br3`, `vowser-eval-v2-br3diag`, `vowser-eval-v2-search`는 `vowser.eval.role=client`일 때만 대상으로 삼는다. 이름 없는 worker가 남아 있으면 별도로 식별한다.
2. 그 대상 worker와 DB만 정지·제거한다. 삭제가 끝난 뒤 19506/19587 포트가 비었고 대상 이름의 컨테이너가 없는지 확인한다. 다른 서비스/과거 평가 컨테이너, Docker 이미지, 전역 volume/network는 정리하지 않는다.
3. `/tmp/vowser-eval-v2`가 실경로이고 심볼릭 링크가 아니며 다른 컨테이너의 bind 원본이 아님을 다시 확인한 뒤, 이 **전용 경로만** 삭제한다. 루트의 `credentials.env`, `mysql.env`, `neo4j.env`(모두 0600)가 비밀 파일이고, `mysql/`, `neo4j/`, `download-check/`는 재생성 가능한 임시 저장소다. 비밀값 내용은 출력하지 않는다.
4. 저장소의 `experiments/2026-09-29/` 전부(원본/보정 raw·중단 archive·SQL 계획·`shared/environment*.json`·재현 코드·보고서)는 보존한다. 기존 `vowser-eval-db-neo4j`, 원본 프로젝트, blog 운영 컨테이너와 데이터, `/tmp/vowser-eval-db` 등 다른 경로는 범위 밖이다. 필요 시 정리 후 `docker ps -a`에서 이름 기준으로만 부재를 확인한다.

이 계획은 정리 대상을 특정할 뿐 실행 권한이나 완료 증거가 아니다. 최종 정리는 DB lease를 회수하고 모든 실험의 DB 의존 증거 저장이 끝난 뒤 수행한다.
