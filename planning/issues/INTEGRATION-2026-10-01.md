# Gradle·Controller·DB 정리 통합 — 2026-10-01

## 통합 범위

별도 작업에서 확정한 Gradle 전환과 Swagger·Api 계약·Flyway 제거가 TS·Thymeleaf 후보에 누락된 상태의 수정. 제거된 작업 폴더의 보존된 기록을 대조하여 현재 본문·인증·저장 계약에 맞게 통합.

- Gradle9.3.0 Wrapper와 Kotlin DSL 사용. Maven Wrapper·pom 제거, Java25/Kotlin2.3.21/Spring Boot4.1.1 유지.
- CI·Pages·Docker·TS 자산·배포 마커를 `build/` 산출물로 통일. `writeSiteClasspath`를 통한 독립 Thymeleaf 생성기 실행. 실행 JAR은 `build/libs/ken-blog-api.jar`.
- Swagger용 계약 파일16개·인터페이스18개 제거. 기존 HTTP 매핑58개·입력·반환 계약을 구체 Controller로 이전. 공개 조회·인증·메타데이터·첨부 기능 유지, 웹 본문 편집 API 재도입 없음.
- Swagger UI·문서 설정·애너테이션·문서용 보안 예외 제거. Spring AI MCP의 JSON Schema 생성에 필요한 간접 라이브러리 `jsonschema-module-swagger-2`·`swagger-annotations-jakarta`는 유지하며 Swagger 문서 엔드포인트 생성 없음.
- Flyway 직접 의존성과 마이그레이션27개 제거. 개발 DB 생성은 JPA `ddl-auto=update`, JPA 밖 JDBC 세션·인증·배포 테이블은 후속 `schema.sql` 초기화. `IF NOT EXISTS`·`INSERT IGNORE`로 기존 행 유지. 운영 DB 삭제·재생성 미수행.
- JPA 고유 제약·외래 키·삭제 규칙·복합 키 열 매핑 보강. 기존 로컬 저장소 검사7개와 삭제/재초기화 검사2개 복원.
- `frontend`·웹 본문 편집기 제거 상태, `resources/templates`·`resources/web`, 저장소 Markdown 정본·미반영 해시 보호, 영속 로컬 첨부, 기존 비밀번호+MFA 유지. Redis·OCI SDK 재도입 없음.
- 현재 구조에 맞는 아키텍처 원본 수정, Redis 아이콘과 구 생성 도면8개 제거. Docker 런타임 디렉터리 그룹을 실제 생성한 `blogdata`로 수정.

## 실제 검증

운영과 별개인 Docker·MySQL 환경, 시험 원고·계정·첨부만 사용.

- Gradle `build writeSiteClasspath` 성공. 마지막 `test` 결과35개, 실패/오류/건너뜀0개. TypeScript 타입 검사와 자산 빌드 포함.
- 실행 JAR의 `schema.sql`·자산 manifest 포함 확인. 원본 TS/CSS 폴더·Flyway·Swagger UI/문서 생성 라이브러리 미포함 확인.
- 빈 사이트와 Tech·프로젝트 대문/문서·노트 회차를 포함한 Pages fixture 생성 성공.
- 실제 실행 JAR에서 MCP 작성/발행, 로컬 이미지 저장과 공개 전달, 잘못된 bearer·오래된 checkout 거부, 배포 중 변경 차단, 전체 공개 원고 동기화 검증 성공.
- 비밀번호+TOTP 로그인, 관리자 Thymeleaf 화면과 메타데이터 수정, 본문 파일 불변·CSRF 거부, 제거된 Swagger/편집기 경로의404 및 본문 작성 경로의405 확인.
- Spring 재시작 후 JDBC 로그인 세션·메타데이터·Markdown·첨부 해시 보존과 로그아웃 확인. SQL 반복 초기화에서 인증 버전·소비된 복구 코드·배포 버전 보존 확인.
- 실제 공개 API 캡처→저장소 Markdown 대조/동기화→로컬 이미지 해시 자산→Thymeleaf Pages HTML 생성 성공. 관리자 JS와 원고 파일의 공개 산출물 혼입 없음.
- Node 스크립트 구문·아키텍처 Python/JSON·변경 diff 검사 성공. Docker 사용자/그룹 생성 명령은 격리 컨테이너에서 `appuser:blogdata`,0750 확인.

Dockerfile 전체 이미지 빌드와 원격 Actions 실행은 미수행. 위 실행 검증은 Gradle JAR을 Java25 검증 이미지에서 실행한 결과.

## 남은 운영 이행

운영 VM 연결 오류와 공인 HTTPS 시간 초과로 기존 원고·OCI 객체 추출/이관 및 새 런타임 배포 보류. 현재 공개 사이트와 운영 데이터 변경 없음. 공개 원고 반영과 새 source 동기화 API 적용 전에 push하면 기존 서버와 새 Pages workflow의 계약이 달라지므로 로컬 커밋만 수행. `build/site`의 시험 산출물은 운영 배포 대상에서 제외.

별도 PORT/CLEANUP/migrations 작업 자료 보존·커밋 제외. 기존 운영 이력은 과거 기록으로 유지.
