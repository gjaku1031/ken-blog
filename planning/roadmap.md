# 새 프로젝트 개발 순서

현재 [P1-02B](issues/P1-02B.md)의 JpaRepository 전환·도입 이력 정정·검증·main·CI·Pages 반영 완료. 현재 [P1-03](issues/P1-03.md) 이미지 첨부 로컬 구현·격리 검증 완료, main·CI·Pages 반영 진행. 세션은 Spring Session JDBC로 기존 MySQL에 저장하고 새 프로젝트의 내부 Redis 제거. 기존 VM 배포 앱·Redis는 교체하지 않음. 공개 HTTPS·도메인·프론트 로그인 연결은 후속 범위.

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
| P1-03 | OCI Object Storage 첨부파일 | 로컬 검증 완료: 비공개 버킷·관리자 이미지 CRUD·실패 복구, 원격 반영 진행 |
| P1-04 | 공개 글 Redis Cloud 캐시 | TTL·수정 시 무효화·장애 시 DB 조회·민감 정보 제외 |
| P1-05 | 회원 권한·공개 범위·Tech 분류 | 목록·검색·직접 URL의 권한 일치 |
| P2 | Tech 화면과 본문 에디터 | 문단→목록→초안·출간→접기·표→이미지→코드·수식·도식→링크 순서로 개별 계획 |
| P3 | Projects·Notes와 관리 | 프로젝트 문서·기술 배지·과목·회차를 기능별로 분리 |
| P4 | 홈·검색·활동 달력·GA | 공개 정보만 집계, GA 측정과 관리 대시보드 분리 |
| P5 | 접근성·성능·운영 복구 | 모바일·다크 모드·키보드, 4GB 실행 예산과 백업·복구 |

초기 P0-01에는 DB·인증·캐시·첨부파일·GA·운영 배포 없음. 확정한 첨부파일 저장소는 OCI Object Storage. GA 측정 ID는 `G-JDYNG61J70`이며 연동 단계에서 사용.

GitHub Pages는 Next 정적 프론트 배포용. 브라우저가 공개 HTTPS Spring API를 호출하는 구조이며 VM에는 Spring 실행. 공개 API 도메인·HTTPS 주소는 아직 미정. 디자인 핸드오프는 후속 화면·에디터 기능의 참고 자료이며 샘플 코드·데이터의 무검증 복사 없음.
