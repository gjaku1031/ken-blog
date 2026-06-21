# 새 프로젝트 개발 순서

현재 [P1-02B](issues/P1-02B.md)의 JpaRepository 전환·도입 이력 정정·검증·main·CI·Pages 반영 완료. 현재 [P1-03](issues/P1-03.md) 이미지 첨부·격리 검증·main·CI·Pages 반영 완료. 세션은 Spring Session JDBC로 기존 MySQL에 저장하고 새 프로젝트의 내부 Redis 제거. 기존 VM 배포 앱·Redis는 교체하지 않음. 공개 HTTPS·도메인·프론트 로그인 연결은 후속 범위.

| 단계 | 작업 | 완료 기준 |
|---|---|---|
| P0-01 | `apps/web`·`apps/api` 초기 구성 | 완료: 앱별 빌드·기동·CI |
| P0-02 | API 오류 응답과 Swagger 계약 | 완료: ProblemDetail, Controller 명세 인터페이스, 응답 검증 |
| P0-03 | Next와 API 연결 | 완료: 공개 상태·설정 및 응답 오류·장애 표시, 호출 경로 구분 |
| P0-04 | 정적 프론트·Spring 실행 이미지 | 완료: Next 정적 Pages, 브라우저 API 호출·CORS, API 단독 Compose·도면 |
| P1-01 | MySQL·JPA·Flyway와 게시글 | 완료: 실제 MySQL 저장·조회·입력 검증·롤백·마이그레이션 |
| P1-02 | Spring Security·로그인 기반 | 원격 반영: 계정·Redis 세션·CSRF·권한·기능별 패키지 |
| P1-02A | Spring Session JDBC 전환 | 구현·검증 완료: MySQL 세션·Flyway·만료 정리·격리 HTTP 검증 |
| P1-02B | Spring Data JPA Repository·도입 이력 정정 | 완료: JpaRepository·기존 계약·검증 유지, 31개 도입 이력 정정·main·CI·Pages 반영 |
| P1-03 | OCI Object Storage 첨부파일 | 완료: 실제 비공개 버킷·관리자 이미지 CRUD·실패 복구·격리 검증·main·CI·Pages |
| P1-04A | 관리자 게시글 초안 API | 완료: 작성·목록·상세·수정·삭제, 격리 검증·main·CI·Pages |
| P1-04B | 출간 상태·공개 글 조회 | 완료: 출간 전환·권한별 목록/상세, main·CI·Pages 반영 |
| P1-04 | 공개 글 Redis Cloud 캐시 | 완료: main·CI·Pages·TTL·해시·커밋 후 무효화·장애 우회·민감 정보 제외 |
| P1-05A | Tech 분류·태그 | 완료: main `e147f10`·CI·Pages, 3깊이 분류·부모 이동 삭제·권한별 건수·태그·필터 |
| P1-05 | 회원 권한·공개 범위·Tech 분류 | 목록·검색·직접 URL의 권한 일치 |
| P2-01 | 공통 화면·Tech 탐색·로그인 | 완료: main `fa86abc`·CI·Pages·격리 브라우저 검증 |
| P2-02A | 공개 원문과 분리된 편집본 저장 | 완료: revision·원자적 출간·원문 보존, main `19b884a`·CI·Pages |
| P2-02B | 기본 블록 편집·수동 저장/출간 화면 | 격리 검증 완료: 정적 글쓰기·원문 보존·편집본 목록, main 반영 진행 |
| P2 | Tech 화면과 본문 에디터 | 문단→목록→초안·출간→접기·표→이미지→코드·수식·도식→링크 순서로 개별 계획 |
| P3 | Projects·Notes와 관리 | 프로젝트 문서·기술 배지·과목·회차를 기능별로 분리 |
| P4 | 홈·검색·활동 달력·GA | 공개 정보만 집계, GA 측정과 관리 대시보드 분리 |
| P5 | 접근성·성능·운영 복구 | 모바일·다크 모드·키보드, 4GB 실행 예산과 백업·복구 |

2026-09-26 전체 잔여 작업 자율 진행 지시 적용. P1-04 캐시는 조회 대상과 공개 규칙 확정 뒤 구현. 계획·검증 기록을 단계별 유지하며 학습 문서 추가 작업은 중단.

초기 P0-01에는 DB·인증·캐시·첨부파일·GA·운영 배포 없음. 확정한 첨부파일 저장소는 OCI Object Storage. GA 측정 ID는 `G-JDYNG61J70`이며 연동 단계에서 사용.

GitHub Pages는 Next 정적 프론트 배포용. 브라우저가 공개 HTTPS Spring API를 호출하는 구조이며 VM에는 Spring 실행. 공개 API 도메인·HTTPS 주소는 아직 미정. 디자인 핸드오프는 후속 화면·에디터 기능의 참고 자료이며 샘플 코드·데이터의 무검증 복사 없음.
