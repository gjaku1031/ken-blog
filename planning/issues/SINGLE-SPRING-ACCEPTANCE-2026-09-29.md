# 단일 Spring Boot 전환 수용 검증

실행한 검증만 PASS. 외부 운영 전환과 미실행 조건은 NOT RUN으로 구분. 기준 HEAD `135169f`. 최종 루트 clean verify 28개 성공(2026-09-29 10:17 UTC), Docker 최종 이미지와 실제 관리자·정적 capture 확인.

PASS 범위: 격리 MySQL·loopback GitHub/HTTPS S3 fixture·Chromium. GitHub Actions 및 OCI 공급자에 대한 신규 운영 연결/배포는 미실행. 실제 OS/Safari IME와 운영 전환/롤백은 NOT RUN. 최종 88개 중 PASS85·FAIL0·NOT RUN3. 상세 로그와 격리 harness는 저장소 밖 `/tmp/ken-blog-single-spring-audit` 보관, 새 저장소 테스트 파일 없음.

| ID | 수용 기준 | 결과 | 근거·제약 |
| --- | --- | --- | --- |
| A01 | 루트 clean verify | PASS | 루트 clean verify와 최종 verify, 기존 28개 테스트 실패·스킵 0; release-verify.log |
| A02 | 앱 수 | PASS | Kotlin 진입점 1개·실행 JAR 1개. Node는 빌드 단계만 존재 |
| A03 | 의존성 삭제 | PASS | pom/package 및 실행 소스의 Next/React/Redis/GA 의존·import 제거 확인 |
| A04 | apps 삭제 | PASS | apps 디렉터리와 CI/Docker/실행 코드의 구 경로 제거. 원본 DB/OCI 별도 보존 |
| A05 | 빈 fixture 빌드 | PASS | 토큰/API 없는 empty fixture 빌드 성공 |
| A06 | clean 후 빌드 | PASS | 소스 내 생성 static 자산 제거 후 clean verify·빈 사이트 재생성 성공 |
| A07 | 배포 경로 | PASS | 공개 /ken-blog 정적 경로, 관리자 API origin /manage 링크·쿠키 분리 확인 |
| A08 | 분할 자산 | PASS | 공개 전용 entry/분할 청크 생성, 관리자 자산 별도 target/generated-resources/static |
| A09 | 실제 JAR | PASS | 실제 JAR 실행 후 /manage·MCP guide/resources/schema 확인 |
| A10 | runtime image | PASS | Docker 다단계 빌드 성공. runtime UID10001/JRE25, node/npm 없음 |
| B01 | 기존 글 이행 | PASS | 격리 V24→V26, posts/drafts/projects/attachments/연결/계정/프로필 보존 열 SHA256 일치; migration-result.json |
| B02 | PRIVATE 글 | PASS | 기존 PRIVATE TECH와 프로젝트 대문 2유형 DRAFT, 공개 조회 404 |
| B03 | PRIVATE 프로젝트 부모 | PASS | PRIVATE project 또는 PRIVATE home의 PUBLIC 하위 문서 DRAFT·조회 404 |
| B04 | 기존 편집본 | PASS | 실제 스키마는 JSON 아닌 분리 열; 기존 HOME 편집본 원문/속성/baseProjectUpdatedAt 유지·상세 조회 |
| B05 | visibility 신규 입력 | PASS | 실제 MCP JSON Schema visibility const PUBLIC; PRIVATE 호출 거절; 웹 PUBLIC 저장 |
| B06 | 기존 migration | PASS | V1~V24 root SQL과 HEAD 구경로 바이트 동일; 격리 Flyway validate |
| B07 | 폐기 기능 | PASS | analytics/view/todo-write/pin HTTP 경로 404/405. 읽기 UI·도구·설정 제거 |
| B08 | 숫자 순서 | PASS | 프로젝트 -9·분류 -5·Notes 2→1 저장·조회; 정적 순서 fixture와 실제 capture |
| B09 | 프로필·배지 | PASS | 보존 열 해시 일치, profile email·badge 로고·프로젝트 선택 배열 API/정적 확인 |
| B10 | 인증 | PASS | 기존 격리 MFA 세션을 old→new JAR 재시작 후 재인증 없이 auth/me 200; 운영 복구 코드 미사용 |
| C01 | 무수정 저장 | PASS | 기존 CRLF/한글/이모지·fence 원문을 실제 웹 무수정 저장 및 MCP 왕복 후 바이트 비교 |
| C02 | GFM 표 | PASS | mixed Node golden: escaped pipe·정렬·한글·코드 span 및 접기 내부 표 |
| C03 | 주석 | PASS | 익명·이름·재참조 주석 번호/복귀 링크 mixed golden·브라우저 확인 |
| C04 | 주석 속 일반/위키 링크 | PASS | 주석 속 일반·위키 링크 sanitize/resolve 및 클릭 가능한 DOM 확인 |
| C05 | 위키 | PASS | title/label·없는 대상·중복 제목 golden; 같은 casefold 제목은 임의 대상 선택 없음 |
| C06 | 가짜 참조 | PASS | 코드·수식·raw HTML의 가짜 attachment/wiki 제외; ZIP AST 변환도 별도 검증 |
| C07 | 수식 | PASS | inline/block·통화 문자·TeX 오류·한글 혼합 Node/browser parity |
| C08 | Mermaid | PASS | flow/sequence·큰 입력/외부 URL 거부, 실제 Blob SVG·원문 버튼·DOM 재사용 확인 |
| C09 | 코드 | PASS | 여러 언어·알 수 없는 언어·탭/공백 원문 보존·브라우저 복사 확인 |
| C10 | 기존 접기 | PASS | 기존 details/summary와 내부 표·주석·이미지 지원, original.md 무변환 |
| C11 | 이미지 metadata | PASS | 다크 쌍·너비·정렬·캡션·양쪽 ID, 정적 PNG·테마 전환·ZIP sidecar 확인 |
| C12 | 앵커 | PASS | 한글/이모지 중복 제목·목차·주석 앵커 Node/browser 일치 |
| C13 | unsafe HTML/URL | PASS | script/event/javascript URL 및 Mermaid 외부 URL 거부 golden |
| C14 | browser와 Node | PASS | 동일 혼합 원문의 Node/Chromium HTML·headings·attachmentIds·wikiTargets 일치 |
| C15 | 한도 | PASS | 1MiB UTF-8·emoji200/201 codepoint·unsafe integer 한도 golden |
| C16 | 빈 문서/미완성 문법 | PASS | 빈 문서·미닫힌 fence golden 및 입력 중 단일 CodeMirror 유지 |
| D01 | 원문 편집 | PASS | Spring /manage 실제 Chromium 단일 CodeMirror 원문 입력·저장·새로고침 |
| D02 | 자동 preview | PASS | 입력 정지 후 미리보기·원문/도식 DOM 유지·undo 검증 |
| D03 | IME | NOT RUN | Chromium compositionstart/end 합성 이벤트는 PASS. 실제 Safari/OS 한글 IME 수동 시험 미실행 |
| D04 | 늦은 비동기 응답 | PASS | revision 취소와 Mermaid 동일 DOM의 source/theme 변경 재렌더 검증 |
| D05 | 큰 혼합 문서 | PASS | 1,001,193바이트 혼합 문서 입력·1.5초 후 window.scrollY344 유지, 입력 처리6ms 측정 |
| D06 | 좌→우 scroll | PASS | 긴 문서·도식 포함 원문 documentTop/lineBlockAtHeight 기준 대응 스크롤 |
| D07 | 우측 수동 scroll | PASS | 오른쪽 수동 스크롤 후 왼쪽 scrollTop 불변 |
| D08 | resize/theme/font | PASS | theme·980px resize·font 변경 후 원문 위치/미리보기 대응 갱신 |
| D09 | 저장 중 입력 | PASS | 900ms 지연 저장 중 추가 입력은 미저장으로 유지, 저장 payload 시점 구분 |
| D10 | 충돌/서버 실패 | PASS | 409/실패에서도 원문 유지, 로컬 다운로드·재조회 및 실제 MCP/web 충돌 검증 |
| D11 | deployment lock | PASS | 배포 gate에서 서버 쓰기 거절, 웹 원문 입력·로컬 다운로드 유지 |
| D12 | 모바일/키보드 | PASS | 390px 원문/미리보기 탭·가로넘침0·Tab 탈출·실제 Spring 모바일 화면 확인 |
| E01 | draft 저장 | PASS | 실제 HTTP draft 저장 전후 dispatch 수 불변 |
| E02 | 발행 | PASS | 원고+QUEUED 동일 commit, 외부 dispatch 단1회; DB 외부 가시성 확인 |
| E03 | 발행 DB 실패 | PASS | 격리 deployment_state BEFORE UPDATE 실패 주입: 원고/편집본/gate 롤백·dispatch0 |
| E04 | 이미 시작한 쓰기 | PASS | 3초 지연 OCI PUT 종료까지 claim 대기; 공개 로고/프로필 경계 코드 대조 |
| E05 | gate 활성 후 쓰기 | PASS | QUEUED/RUNNING HTTP와 MCP 쓰기 CONTENT_WRITE_LOCKED. 서비스 mutation 목록 대조 |
| E06 | 세션·상태 쓰기 | PASS | 활성 gate에서 auth/me/상태 조회, bearer+세션 쿠키 혼합 후 기존 MFA 세션 보존 |
| E07 | 병렬 발행 | PASS | 동시 발행 한 요청만 성공, 다른 요청409; 원고/operation 중복 없음 |
| E08 | dispatch 거절 | PASS | GitHub mock dispatch 거절 후 원고 PUBLISHED 유지, 배포 FAILED |
| E09 | dispatch timeout | PASS | timeout/응답 유실 시 QUEUED 유지. 원격 operation 조회로 run 연결 복구 |
| E10 | 미귀속 queued run | PASS | 미귀속 QUEUED에서 push 가로채기 거절; 원격 부재 확인 후 명시 abandon만 허용 |
| E11 | push/manual 동시 실행 | PASS | push/manual과 publication 동일 gate, busy claim409·남의 operation 변경 불가 |
| E12 | 이미지 수집 실패 | PASS | 실제 capture에서 mock S3 원본 제거: build 비정상 종료·직전 artifact 해시 불변·lock 유지 |
| E13 | build/upload 실패 | PASS | running failure callback만으로 해제 안 됨. 종료/Pages step 확인 후 FAILED 복구 |
| E14 | Pages 성공/callback 실패 | PASS | 정확한 Pages step+marker 일치로 SUCCEEDED 복구. 후속 workflow failure와 구분 |
| E15 | 취소/force-cancel | PASS | 취소·cleanup 미실행 fixture 및 no-Pages-step 종료 복구, 재시작 시 잠금 유지 |
| E16 | Spring 재시작 | PASS | RUNNING 상태에서 Spring 재시작, durable owner/run/attempt 보존 |
| E17 | stale callback | PASS | 이전 operation 및 잘못된 runAttempt callback409, 현재 gate 불변 |
| E18 | 재시도 | PASS | 관리자 재시도 새 operation 생성, 기존 원고 중복 없음 |
| E19 | duplicate complete | PASS | 동일 complete 멱등, 다른 결과409 |
| E20 | 새 공개 metadata 변경 | PASS | profile/email·배지 로고·분류/프로젝트 순서·과목 변경 각각 queue, 실제 capture 반영 |
| E21 | queued concurrency 취소 | PASS | queued run 취소/no Pages step을 remote terminal로 확인해 FAILED 복구 |
| E22 | operation 생성 직후 crash | PASS | 공개 commit 후 dispatch 응답 전 API SIGKILL: 원고/QUEUED 보존, 원격 operation 재귀속 |
| E23 | tx commit과 guard 순서 | PASS | TransactionTemplate commit까지 single-JVM lock 유지; 지연 dispatch 중 DB+gate 조회 검증 |
| E24 | cancelled 후 late callback | PASS | cancelled/abandoned 옛 run의 late claim/callback 거절, 새 operation 보호 |
| F01 | 최초 HTML | PASS | 실제 API capture29페이지의 HTML 본문·주석·이미지 src 및 no-JS fixture 확인 |
| F02 | OCI API 차단 | PASS | 브라우저 /api/v1/** 차단 후 본문·이미지·검색·탐색 동작, 실패 요청/JS오류0 |
| F03 | 삭제/철회 | PASS | 실제 HTTP unpublish→capture 후 구 route/search/sitemap 제거. empty rebuild 후 잔여첨부0 |
| F04 | 신규 글 | PASS | 실제 TECH/PROJECT_HOME/NOTE_CHAPTER 공개 캡처 및 부모 탐색 fixture |
| F05 | 구 query URL | PASS | legacy query 고정 route 변환, 잘못된 값/외부 주소 이동 거절 |
| F06 | 관리자 링크 | PASS | 정적 관리자 링크 Spring origin /manage, 공개 번들에 인증 UI 없음 |
| F07 | artifact 검사 | PASS | 공개 전용 artifact scan·PRIVATE fixture 거절·구 artifact 보존. 관리자/초안/내부 파일 제외 |
| F08 | 용량/자산 | PASS | 분할 청크30개200·fonts/CSS/라이선스·정적 이미지 확인; artifact 크기 기록 |
| F09 | export | PASS | 실제 인증 HTTP ZIP: CRLF original·상대 이미지·dark sidecar·tags/부모/숫자순서 일치 |
| F10 | export 잘못된 경로 | PASS | ZIP 경로/중복 검사·선택자 검증·없는 객체는200 이전 실패·임시 ZIP 정리 |
| F11 | MCP 새 클라이언트 | PASS | 새 클라이언트 실제 JAR: 30tools/4resources·PUBLIC schema·guide·web/MCP 이어쓰기20건 |
| F12 | 기존 콘텐츠 수량 | PASS | 운영 읽기 전용 전후 전 테이블 보존 hash 일치. 격리 PRIVATE 전환은 대응표 별도 확인 |
| F13 | 운영 식별 | NOT RUN | 기존 운영 image/Pages run은 읽기 전용 기록. 새 source의 운영 image/run/marker 적용 미실행 |
| F14 | 제거 기능 네트워크 | PASS | API 차단 브라우저에서 analytics/view/todo/auth 요청 없이 독자 기능 동작 |
| F15 | 공개 배포 롤백 | NOT RUN | 운영 app/data/Pages rollback 실행 미승인. 문서 절차와 격리 artifact 보존까지만 확인 |
| F16 | 최종 상태 | PASS | 격리 gate SUCCEEDED 확인 후 전용 container/schema/객체/자격증명·mock 서버·브라우저 종료. 기존 fixture/운영 보존 |
