# TS·Thymeleaf와 저장소 원고 중심 축소

구현·격리 검증 완료, 운영 이행과 push 보류. 실제 검증일2026-09-30 UTC(2026-10-01 KST). 기준 소스`1124236c0b5f95eec7bde2ffba562a96ab0c6723`.

## 사용자 확정과 변경 결과

- 공개 사이트는 GitHub Pages 유지. Kotlin·Thymeleaf로 빌드 시 HTML 생성, 관리자 `/manage/`는 Spring Thymeleaf 렌더링.
- `src/main/frontend` 제거. 템플릿은 `src/main/resources/templates`, TS·CSS와 공통 읽기 렌더러는 `src/main/resources/web`으로 이동. Maven·npm 자산 빌드와 해시 manifest 사용, 운영은 JRE만 사용.
- CodeMirror와 웹 본문 편집·초안 API 제거. 웹은 제목·요약·분류·태그·프로젝트 기간/상태·프로필·과목 메타데이터와 Pages 생성 기능 제공. 비밀번호+MFA·JDBC 세션·CSRF·ADMIN 경계 유지.
- 본문 원본은 `content/posts/{slug}.md`. 미발행 원고·MCP 편집본·기준 해시·미반영 해시는 Git 제외 디렉터리에 보관. 기존 DB 본문 열은 복구·호환용 유지, Flyway27개 수정 없음.
- 최초 부팅만 기존 DB 원고를 없는 파일로 추출. 초기화 표식 이후 공개 원본 파일 누락은 부팅 실패로 처리하여 오래된 DB 본문으로 조용히 복원하지 않음. 기존 PRIVATE 자료 자동 공개 없음.
- MCP 저장·발행은 파일 원본에 반영하고 Git 반영 필요 상태 반환. 본문 발행 자체는 Pages 자동 예약 없음. 커밋·push 이후 workflow가 공개 목록 전체의 checkout 원고를 검증·동기화.
- workflow 전용 bearer와 run/attempt 소유권 검증 유지. 미반영 원고 해시 불일치는409로 거부, 검증 전 파일 변경 없음. 직접 GitHub 수정은 checkout 본문을 서버 파일·DB 호환 열에 동기화.
- OCI Object Storage SDK 제거. 기존 DB object key를 유지하는 영속 로컬 파일 저장·전달·내보내기 사용. 명시한 영속 루트 없이503, 경로 이탈·심볼릭 링크 거부. Redis 없음.
- `ops/migrate-oci-assets.py`는 기존 객체 복사·SHA256 대조·재실행 검증용. 원격 객체 삭제 없음. `ops/prepare-local-storage.py`는 기본 미리보기와 명시적 apply로 자산 UID10001/GID1001, 본문 공유 GID1001·파일0660 권한 준비.

## 실제 검증

- 격리 Java25·Node24.21·MySQL8.4.11 환경의 Maven `clean verify` 성공. 기존28개 검사, 실패0·오류0·건너뜀0. 신규 저장소 테스트 없음.
- 최종 정리 후 Maven package·실행 의존성 준비와 TS 타입/해시 자산 빌드 재확인 성공. npm audit 취약점0. Compose 개발·운영/직접 HTTPS 구성 검증.
- 빈 공개 fixture와 TECH/PROJECT_HOME/PROJECT_DOC/NOTE_CHAPTER를 모두 포함한 fixture의 Kotlin·Thymeleaf 생성 성공. 모든 본문은 별도 Markdown 파일 원본 사용, 오래된 API 본문 배제 확인.
- 격리 실제 Spring API 수집→workflow 원고 검증·동기화→로컬 첨부 다운로드→정적 HTML 생성 성공. 원고·첨부 fixture와 시험 자격 정보는 저장소 밖 사용.
- MCP 편집본·발행·로컬 이미지 전달, 미반영 해시와 파일0660, 직접 Git 수정 동기화 확인. 오래된 checkout409·누락 원고409·본문 비문자열400·잘못된 attempt409·잘못된 bearer401 검증. 배포 중 MCP 콘텐츠 쓰기 차단 확인.
- Chromium에서 기존 비밀번호+TOTP 로그인, 메타데이터·태그·프로젝트 기간/상태 변경, 본문 원본 보존, 로그아웃 후401 확인. CSRF 없는 변경403, 웹 본문/파일 입력과 CodeMirror DOM0 확인.
- 생성된 공개 HTML의 Markdown 표·KaTeX·Mermaid·위키주석·목차·시리즈 확인. Mermaid Blob 이미지 실제 로드300×49, 수식2개·표1개·JS 오류0. 공개 자산에 관리자 번들·TS·원고 혼입 없음, 읽기 중 API 재조회 없음.
- 기존 로컬 저장/이관 스크립트의 임시 객체·권한·재실행·링크 거부 검증 성공. 실제 운영 원고나 사용자 MFA·복구코드를 이용한 시험 없음.
- 이번 격리 API·MySQL·브라우저 컨테이너와 미리보기 HTTP 서버 종료. 전체 운영 Docker 이미지 빌드·운영 재시작·실제 Pages 배포는 미수행.

## 운영 이행 잔여와 보류 근거

OCI Root workspace 연결은 반복하여 MCP `-32603 Internal error`, 공인 운영 HTTPS 연결도 시간 초과. 현재 셸의 Docker daemon은 격리 검증 환경으로 확인되어 운영 컨테이너·DB 접근 수단으로 사용하지 않음.

기존 DB 원고와 OCI 객체는 이번 작업에서 변경·삭제·이관하지 않음. 현재 저장소 `content/posts`에는 원고가 없으며, 기존 운영 백엔드에는 새 workflow 원고 동기화 API 없음. 지금 push하면 기존 Pages workflow가 새 계약으로 실행되어 실패하므로 검증된 소스만 로컬 커밋하고 push 보류.

1. 운영 연결 복구 후 DB·객체 목록·해시와 환경·이미지 복구 자료 확보.
2. 기존 객체를 영속 로컬 `assets`로 복사·해시 검증, 공유 `content` checkout과 마운트 권한 준비. 기존 DB/Flyway·계정·세션 유지.
3. 새 런타임 최초 부팅으로 기존 원고·편집본 추출, 공개·미발행 파일과 기존 DB 본문 대조. 공개 원고만 저장소에 반영, 미발행·비밀 파일 Git 제외 확인.
4. 소스·공개 원고 커밋과 main push, 실제 CI/Pages 완료와 배포 marker·잠금 해제 확인. 기존 운영 원고·첨부·계정 보존 대조.

Nginx 운영 제거는 이전`1124236`에서 이미 완료된 이력이며 이번 후보의 신규 완료 항목으로 계산하지 않음. 이번 전환의 운영 완료·실제 Pages 성공으로 보고 금지.
