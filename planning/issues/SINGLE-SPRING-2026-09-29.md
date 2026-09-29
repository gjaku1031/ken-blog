# 단일 Spring Boot·원문 편집기 전환

## 확정 범위
- root pom.xml/src/.mvn/Dockerfile로 통합, apps/와 Next/React 제거.
- MySQL/OCI Object Storage/MFA/JDBC/MCP 유지. PRIVATE 원고는 DRAFT 보존.
- CodeMirror 좌측원문·우측 자동미리보기, GFM·위키주석·수식·Mermaid·코드 유지.
- 공통 Markdown 렌더러를 관리자 미리보기와 정적생성에 공유, Pages 독자 API 의존 제거.
- 발행시 Actions 요청, cron 제거. 콘텐츠 쓰기만 배포기간 차단, durable배포ID와 종료확인 복구.
- 통계·추적·조회수·핀·읽기체크쓰기·블록/DnD·Redis 제거. Markdown+첨부 export.

## 구현 분담
- backend: 기존 Kotlin 서비스/API/MCP·V25·기존테스트·작성skill.
- editor: src/main/frontend/admin/ (root contract 참조).
- renderer: src/main/frontend/shared/, public/, scripts/site/, package.json/lock, tsconfig, scripts/build-frontend.mjs.
- deployment: src/main/kotlin/.../deployment/, V26, .github/workflows/, scripts/deployment/.
- integration: root 구조·pom·Docker/Compose/nginx·설정·검토·격리/운영 검증·커밋/push.

## 검증
- 구현·격리 검증과 운영 전환을 분리해 기록. 수용표의 PASS는 명시된 격리 환경 결과.
- 현재 기준 135169f. 사용자 콘텐츠/로그인/외부PORT 보존.


## 재개 기준선 · 2026-09-29

- 기준 HEAD `135169fa080ec6b331e0e1f289323e4ee578748f`, root 이전·편집기·배포 기능 미커밋 상태에서 재개. 초기화·복구 없이 기존 구현과 상세 설계 대조.
- 파일 상태·내용 해시를 저장소 밖 `/tmp/ken-blog-single-spring-audit`에 기록. PORT/CLEANUP 자료·원고·첨부·로그인 보존.
- 기존 V1~V24 SQL은 이전 경로의 HEAD와 바이트 비교 일치. 격리 DB의 현재 적용 버전 V24 확인.
- 우선 수정 대상: 공개 변경 commit과 QUEUED의 분리, run attempt/Pages 결과 검증 누락, public 산출물에 관리자 공통 청크 포함, 소스 경로에 생성 자산 기록, 미리보기·저장 충돌·기존 원문 호환 검증.
- 코드/격리 검증 먼저 진행. 운영 전환은 설계 04의 자격증명·백업·워크플로 종료·엔드포인트 준비·승인 범위 확인 후 별도 판정. push가 운영 Pages를 변경하므로 전환 준비 전 원격 push 보류.
- 수용 항목별 실제 근거는 `SINGLE-SPRING-ACCEPTANCE-2026-09-29.md`에 기록.


### 재개 검증 1차

- root `./mvnw -B clean verify` 성공, 기존 테스트 28개 실패·스킵 0. 이 결과는 초기 미커밋 구현의 기준선이며 후속 수정 최종 결과와 구분.
- 운영 읽기 전용 조회: Flyway V24, 공개 원고 7·편집본 4·첨부 7·프로젝트 6·기술 배지 71·계정 1. 운영 파일·본문 출력 없이 보존 해시 기록.
- 운영 배포 전용 토큰/콜백 토큰과 GitHub `BLOG_API_BASE_URL`·`BLOG_DEPLOY_TOKEN` 미설정. 운영 MCP는 25개 도구·4개 리소스의 구형 안내. 신규 구조 적용 완료로 간주하지 않음.
- 격리 V24 스키마 사본에 PRIVATE 글·부모별 PRIVATE 프로젝트/대문·기존 편집본·CRLF/한글/이모지·라이트/다크 첨부를 준비. V25/V26 이행 후 보존 열 SHA256·ID/slug/부모/원문/첨부 연결 일치, PRIVATE와 해당 자식 DRAFT, 기존 MFA 세션 재사용 200 확인.
- 객체 저장은 임시 HTTPS S3 호환 fixture 사용. 운영 OCI 객체 변경 없음. 실제 OCI 공급자 연동 검증과 구분.


### 최종 구현·검증 · 2026-09-29

- 루트 Maven Spring Boot와 `/manage/` 원문 편집기로 통합. `apps/`·Next/React·블록 편집·통계/조회수/핀·읽기 체크 수정·Redis 제거. MySQL/OCI·계정/MFA/JDBC 세션·기존 ID/slug/Markdown 유지.
- 공개 변경과 QUEUED를 하나의 transaction에 기록하고 commit 뒤 GitHub 요청. 단일 JVM 콘텐츠 경계가 첨부 I/O와 transaction 종료까지 포함. 정확한 operation/run/attempt·실제 Pages step·marker 확인, 재시작/취소/응답 유실 복구 및 명시 abandon 지원.
- 실제 GitHub 대신 loopback HTTP GitHub fixture, 실제 OCI 대신 전용 loopback HTTPS S3 fixture, 전용 MySQL 스키마 사용. 외부 운영 연결 검증과 구분.
- 기존 검사 28개, 배포 HTTP 28항목, 추가 crash/취소/경합 8항목, MCP 이어쓰기/차단 20항목 통과. DB gate 기록 실패 주입 시 원고/편집본 변경까지 rollback 확인.
- CodeMirror 단일 원문·CRLF 유지·입력 중 저장 경합·409 원문 보존·1MiB 혼합 문서 스크롤·모바일 전환 확인. 실제 Spring 화면에서 세션 인증·저장·새로고침·도식 DOM 유지 확인. 합성 composition 이벤트 통과와 실제 Safari/OS IME 미실행을 구분.
- 공통 렌더러의 표·주석·위키·접기·다크 이미지·코드·Mermaid·KaTeX·앵커·크기 제한을 Node/Chromium 대조. API 차단 및 JavaScript 비활성 상태에서도 공개 본문/이미지 표시. 공개 자산과 관리자 자산 분리, 내부 경로·원문 파일 저장소·새 Node 서버 없음.
- 실제 API capture에서 발견한 TECH 요약 DTO의 section 필드 부재 수정. 누락 없이 29페이지/이미지2개 생성 확인. 이미지 수집 실패 시 직전 artifact 해시 불변, 실제 발행 철회 후 route/search/sitemap 제거 확인. signed 숫자 순서·프로필 이메일·배지·관련 글·역링크·중복 위키 대상 처리 확인.
- ZIP은 전용 관리자 인증·명시 선택 범위·includeDrafts 옵션 사용. 원문 바이트·상대 이미지·다크 쌍 메타데이터·부모/태그/순서 보존, 코드/수식 속 가짜 참조 제외, 누락 이미지는 HTTP200 전에 실패, 임시 ZIP 정리 확인. DRAFT 원본의 목록 ZIP 링크도 수정.
- Markdown/도식 의존성은 mdast-util-to-hast13.2.1 및 lodash-es4.18.1로 한정 보정. npm audit 취약점0, 변경된 렌더러/브라우저 검증 재실행.
- 실제 운영 읽기 전용 전후 검증에서 Flyway V24·공개 글7·편집본4·첨부7·프로젝트6·배지71·계정1 및 각 보존 테이블·설정·컨테이너 해시 일치. 운영 원고/파일/MFA 복구 코드 변경 없음. 무관한 PORT/CLEANUP은 커밋 범위에서 제외.

### 운영 전환 대기 조건

- 이 작업은 신규 운영 쓰기/배포 승인으로 간주하지 않음. 원격 push가 Pages를 실행하므로 로컬 커밋까지만 진행.
- 운영 `APP_DEPLOY_ENABLED`·GitHub token·callback token, GitHub `BLOG_API_BASE_URL`·`BLOG_DEPLOY_TOKEN` 미설정. 실제 토큰 생성·등록·권한 확인 미실행.
- 현재 운영 MCP는 V24 서버의 25tools/4resources. 설치된 프로젝트 작성 스킬은 새 root resource를 가리키므로 운영 MCP 전환 전 새 도구/발행 상태 계약 사용 금지. 격리 새 JAR은 30tools/4resources 확인.
- 실제 운영 image/새 Pages run/marker 연결, 승인된 DB·첨부 백업과 rollback rehearsal, old workflow 종료, 동일 출처 `/manage/` endpoint/cookie 전환 후 신규 workflow 활성화는 설계04의 순서대로 별도 수행 대상.
- 기존 Pages 최신 읽기 전용 확인: run `36546223080`, source `135169fa080ec6b331e0e1f289323e4ee578748f`, success. 새로운 코드의 운영 적용을 의미하지 않음.
- V1~V24 SQL 불변, V25~V27 이행은 격리 스키마만 적용. 운영 V24에는 새 deployment_state가 없으며 신규 gate 활성화 없음.


### 최종 산출물·정리 확인

- 최종 clean verify 2026-09-29 10:17 UTC 종료, 기존 테스트28 PASS. 최종 Docker image `sha256:7d7885410552ddf0e8ed29348a4ee789f50cedeb015b4983c39a723982a6053a`, 비루트 JRE 기동·health·`/manage/`·기존 격리 세션 유지 확인. 운영 이미지로 교체하지 않음.
- 최종 Docker API 기반 Pages capture: TECH23·Projects2·Notes1의 격리 원고, 파일350개/10,222,462바이트. 초안/내부 디렉터리/관리자 JS/소스맵/DB dump/자격증명 값 미포함 확인. 해당 fixture artifact를 운영 발행하지 않음.
- 실제 운영 API image `sha256:3d49b82a7eef24df4827fe4b30928a1ea774a94820bdf647b5d975d3170989ef`, 기존 web proxy image `sha256:3ef45bd4c7440a65c3d40f0822e80dc7bb12c3776d1bee01c55257134db84238` 유지. 신규 marker의 운영 설치 없음.
- 격리 최종 배포 상태 SUCCEEDED 확인 후 전용 audit container/schema·mock 객체·임시 자격증명·서버/브라우저 정리. 기존 검증용 MySQL schema와 운영 컨테이너에는 변경 없음. 검사 로그/해시·harness만 저장소 밖 보존.
- 수용표85 PASS/0 FAIL/3 NOT RUN. NOT RUN은 실제 Safari/OS IME, 신규 운영 image/run/marker, 운영 app/data/site 롤백. 로컬 코드 완성과 운영 전환 완료를 구분.
