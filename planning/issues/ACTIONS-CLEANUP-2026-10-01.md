# Actions 배포 이관과 미사용 코드 정리 — 2026-10-01

## 변경

- 사용자 승인 범위: 배포 관리를 GitHub Actions로 이관하고 현재 사용하지 않는 코드 정리. Gradle·TS·Thymeleaf·저장소 Markdown·기존 비밀번호+MFA 유지.
- Pages workflow는 main push 또는 workflow_dispatch. build/site 검증·업로드·배포 단계만 유지. finalize workflow, 배포 client, bearer/dispatch 환경 설정과 배포 ID 입력 제거.
- Spring deployment 패키지, 상태·원격 실행·claim/complete/recover·MCP 배포 도구·전역 변경 차단 제거. 관리자 화면은 Pages Actions 실행 링크와 DB 저장 후 수동 실행 안내 제공.
- 단일 공개 GET /api/v1/pages/snapshot 도입. 같은 MySQL 일관 읽기에서 공개 메타데이터와 자산 revision 계산. 비공개 글·숨겨진 부모의 문서·서버 파일 경로·본문 원고 제외. DBbody 열은 호환·복구용으로 보존.
- Pages 빌드는 checkout Markdown과 공개 이미지 사용. 파일 형식·크기·UTF-8·이미지·산출물 검사와 생성 종료 전 revision 대조. 원고 파일 누락 또는 DB/이미지 revision 변경 시 기존 산출물 교체 전 실패. 서버 원고 동기화 쓰기 제거.
- 서버 편집본 엔티티·저장소·서비스·첨부/위키 선언 계층, MCP 초안 작성/수정/발행과 본문 입력 DTO 제거. 공개 다중 JSON 조회 Controller 제거, 이미지·관리자·MCP의 필요한 기능 유지.
- 본문 없는 메타데이터 등록은 TECH·PROJECT_HOME·PROJECT_DOC·NOTE_CHAPTER 지원. 공개 상태와 첨부 연결은 메타데이터만 갱신, 원고 파일 생성·수정·삭제 없음. MCP 등록 결과는 작성할 상대 Markdown 경로 제공.
- 관리자 상세 본문에 의존하던 구 위키 재색인 스크립트와 안내 제거. Pages는 Git 원고에서 위키 대상을 직접 해석. 기존 검사 기록과 기존 자료 보존.
- ops/export-markdown.py는 기존 posts/editor_drafts와 연결 메타데이터의 일회성 읽기 전용 추출기. 공개 부모 조건에 맞는 글만 posts, 나머지는 local-posts, 편집본은 local-drafts, 원래 메타데이터는 Git 제외 legacy-metadata에 보존. 기존 파일 덮어쓰기 거부.
- 도면의 원고 흐름을 읽기 전용 저장소로 정정하고 미사용 Next.js·Nginx 아이콘과 출처 항목 제거.
- 신규 저장소 테스트 추가 없음. 기존 PostPersistence 검사만 메타데이터 흐름에 맞춰 수정. 실제 DB DROP·원고/첨부/계정 삭제 없음. content_state는 분류·프로젝트 순서의 DB 동시 변경 제약용으로 유지.

## 실제 검증

- Java25·Node24.21·Gradle9.3.0의 캐시된 격리 컨테이너에서 offline clean build writeSiteClasspath 성공. 기존35개 검사 전부 성공, failures/errors/skipped0. TypeScript·브라우저 자산 생성 성공.
- 가짜 자격 증명의 격리 MySQL8.4와 Spring 실행. 최초 부팅에서 원고 파일 생성 없음, 새 DB에 deployment/editor 상태 테이블 없음 확인.
- 비밀번호+TOTP·CSRF·SSR 관리자 정상. 본문 등록/수정 입력400, CSRF 없는 변경403, 제거한 배포/편집본/구 공개 JSON/Swagger 경로404 확인.
- REST로 네 섹션을 본문 없이 등록·공개 상태 전환 후 파일 생성 없음 확인. 직접 작성한 Markdown과 MCP 이미지로 실제 API → Pages HTML·이미지 생성 성공. 공개 피드에는 기존 계약대로 TECH·PROJECT_DOC·NOTE_CHAPTER3개, 프로젝트 대문은 별도 페이지 생성.
- 비공개 본문 및 숨겨진 프로젝트 문서 canary가 공개 snapshot/HTML에 없음 확인. 링크된 이미지 전달 바이트와 Pages 해시 이미지 일치, 내부·관리자 소스 제외 확인.
- 실제 수집 종료 직전 메타데이터를 변경한 빌드와 Markdown을 제거한 빌드 모두 실패, 이전 성공 산출물의 전체 파일 해시 보존 확인. 빌드 중 메타데이터 저장 가능 확인.
- Chromium으로 로그인·관리자·정적 홈·Tech·프로젝트 문서·Notes 회차 확인, JS 오류 없음. 관리자 Actions 링크/메타데이터 폼과 이미지 로딩 확인.
- 추출기로 공개4개·비공개/숨겨진3개·기존 편집본1개를 격리 DB에서 보존 추출. 동일 파일 재실행 허용, 충돌 파일 덮어쓰기 거부, DB 행 해시 동일·파일 권한 확인.
- 이전 editor_drafts와 RUNNING deployment_state를 격리 DB에 남긴 재기동에서 실제 테이블/행 보존. JDBC 로그인·DB 메타데이터·Markdown/로컬 이미지 해시 보존과 로그아웃 확인. 구 RUNNING 상태가 MCP 메타데이터 등록을 막지 않음 확인.
- 최종 소스 build/writeSiteClasspath와 기존35개 검사 재통과, 작성 안내 반영 후 bootJar 성공. 최종 JAR의 제거 패키지 부재·현재 안내 포함, 재기동 snapshot과 원고/이미지 해시 확인.
- MCP 초안·배포 도구 부재, 메타데이터 등록의 파일 쓰기 없음, 원고 조회가 DBbody 대신 Git 파일 사용 확인. 정적 검색과 git diff --check 성공.

## 적용 상태

- 소스 구현과 격리 검증 완료. 실제 GitHub Actions/Pages 실행, 운영 DB/원고/객체 이관과 운영 Spring 배포 미수행.
- 운영 연결 및 기존 데이터 보존 이행 전 push 보류. 공개 원고 content/posts는 아직 .gitkeep만 존재. 운영이 새 snapshot API를 제공하고 공개 원고가 Git에 반영된 뒤 push/Pages 실행 필요.
- 시험 자료와 build/site는 운영 콘텐츠가 아니며 배포 대상에서 제외. 운영 이행은 DB/OCI 백업 → 원고·편집본 추출 → OCI 객체 로컬 이관 → 권한 준비 → 새 런타임과 보존 확인 → 공개 원고 Git 반영 → push/Actions 검증 순서.

## 미사용 ZIP 내보내기 추가 정리

- 사용자 후속 지적으로 데이터 내보내기 전체 참조 점검. 관리자 웹·MCP·Actions가 호출하지 않는 GET /api/v1/admin/export와 ContentExportController/Service·ZIP DTO·휴대용 Markdown 보조 함수를 제거. 약400줄의 런타임 계층과 전용 org.commonmark:commonmark 의존성 제거.
- MCP 작성 가이드의 ZIP/includeDrafts 안내 제거. ops/export-markdown.py는 실제 운영 DB 원고·편집본 이관이 남아 있어 유지, DB 백업/복원 도구와 실제 기존 파일/데이터 변경 없음. 과거 ZIP 검증 기록은 당시 이력으로 유지.
- Gradle offline clean build/writeSiteClasspath 성공, 기존35개 검사 failures/errors/skipped0. TypeScript·브라우저 자산 생성 성공. 새 JAR·Pages classpath에서 ZIP 클래스와 CommonMark 부재, 가이드의 구 ZIP 안내 부재 확인.
- 삭제 후 네 섹션의 저장소 Markdown을 Thymeleaf HTML로 생성하고 CI 빈 Pages fixture도 성공. 신규 저장소 테스트 추가 없음. git diff --check와 활성 코드의 export API·DTO·파서 잔여 참조0건 확인.
- 로컬 소스 정리이며 원격 Actions·운영 이관·push 미수행. 운영 원고/첨부 이관 전 push 보류 유지.
