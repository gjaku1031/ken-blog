# 현재 작업

- 전달받은 인증 자료를 통한 GA4 운영 보고서 연결 완료: [계획과 검증](issues/GA4-CONNECTION-2026-09-27.md). 운영 7·30·90일 READY 및 실제 Pages 대시보드 확인. 사용자 확정 측정 ID로 익명 공개 방문 수집 HTTP 204·관리/로그인 수집 제외 확인, 비밀값 저장소 밖 보관.

- 빈 여백 클릭 시 블록 선택 해제 보정·배포 검증 완료: [계획과 검증](issues/BLOCK-SELECTION-DISMISS-2026-09-27.md). 마퀴·다중선택·이미지·텍스트 편집 보존, 운영 원고 변경 없음.

- 공통 폭 확대·분류 드래그 순서·연관 프로젝트 줄 구현 및 격리 검증 완료: [계획과 검증](issues/LAYOUT-CATEGORY-ORDER-2026-09-27.md). GA 미연결 원인은 숫자 속성 ID·서비스 계정 인증 설정 부재로 확인, 사용자 미보유 확인 및 준비 절차 안내 대상. 실제 Pages 최종 확인 대상, 기존 데이터 보존.

- 읽기·편집 QA 보정 구현·정적 브라우저 검증 완료: 본문 폭 +52px, 시리즈 6개 페이지 이동, 블록 선택 여백·드래그 선택, 출간 창 균형, Tech 재방문 목록 갱신. [계획과 검증](issues/READING-EDITOR-QA-2026-09-27.md) 기준 타입·기존 7개·정적 빌드 통과. 최종 main/Pages 반영 확인 대상. 사용자 작성 글과 기존 QA 자료 보존.

- 주소 직접 지정 기능 제거 구현·로컬/운영 API 검증 완료: Tech·Projects·Notes의 작성/수정 입력과 요청 필드 제거, 서버 자동 주소 발급 및 기존 주소 유지. [계획과 검증](issues/AUTOMATIC-ADDRESSES-2026-09-27.md) 기준 기존 검사·저장/출간·이름 변경·구 요청 호환 통과, Pages 최종 반영 확인 대상. 기존 QA 자료 보존.

- 탐색 UI·제목 QA 보정 구현·로컬 검증 완료: 공통 분류 펼침 아이콘·클릭 영역 확대, Projects/Notes 목차 여백 복원, 사용자 확정 제목 크기 32/28/24/20px 읽기·글쓰기 적용. [검증 기록](issues/NAVIGATION-TYPOGRAPHY-2026-09-27.md) 기준 실제 CSS·키보드·세 화면 폭·기존 7개 검사·정적 빌드 통과. main/Pages 반영 대상, QA 데이터 유지.

- 글쓰기 후속 보정 구현·로컬 검증 완료: 프로젝트 팝오버·분류 3깊이 생성·주석 흔들림·다중 선택/이동·이미지 좌중우·선택 줄 Markdown 원문/제목 크기 유지. [계획과 검증](issues/EDITOR-UX-2026-09-27.md) 기준 웹 기존 7개·타입검사·정적 빌드 및 실제 입력/저장 통과. main/Pages 반영과 배포 확인 대상. 사용자 QA용 운영 출간 글 109개·임시저장 12개 유지, QA 종료 요청 전 삭제 금지.

- 원본 디자인 전수 재구현·목업 검증 및 정리 완료: [검증 기록](issues/DESIGN-PARITY-2026-09-27.md). 51개 상태·13개 모바일 대조, 사용자 지적 글쓰기/핀/프로젝트 목차 반영. API 운영 반영 완료, main/Pages 동일 변경 배포 후 동작 확인 대상. GA4 미연결, 이메일 없는 계정, 태그 표시 철자 보존.

- 최신 요청: 실제 서비스 연결까지 수행, Tailscale API 별칭 유지 및 Pages 접근용 OCI 공인 HTTPS 구성, 이메일 기능 전면 제거. [운영 연결 기록](issues/CONNECTION-2026-09-27.md) 기준으로 실제 배포·로그인·저장·초대 검증 완료. 아래 이전 통합 전달 시점의 미연결 상태는 이 기록으로 대체.

- 2026-09-27 최신 요청으로 전체 구현 재개. 단일 폴더의 P3-01 미완성 변경을 보존하고 Projects·Notes·홈·검색·관리·회원·분석·운영 구성을 통합 전달. 단계별 중단과 작은 단위 전달 대기 없음.
- 사용자용 README·docs·학습 문서 삭제. 구현 규칙은 `planning/code-conventions.md`, 운영 도구 안내는 `planning/reference/`로 이동. 프로젝트 백업/작업 사본 정리, 별도 PORT 작업 보존.

- 2026-09-27 남은 프로젝트 끝까지 자율 진행 재확인. 계획·검증·기능별 커밋·main 직접 push 유지, 단계별 승인 대기와 학습 문서 추가 없음.
- 구현 완료: Projects·Notes·Home·검색·시리즈·핀·조회·전체 관리 화면·초대·GA 연동 코드·운영 이미지/복원 도구. [통합 검증 기록](issues/DELIVERY-2026-09-27.md)에 실제 결과와 외부 조건 유지.
- 현재: 최종 브라우저 확인 완료, 통합 커밋·main 반영 및 해당 SHA의 CI/Pages 확인. 실제 원격 상태는 Git과 Actions 기준. 상세 수용 기준은 [전체 체크리스트](delivery-checklist.md), 이전 단계는 [로드맵](roadmap.md)과 개별 계획에 보관.

## 검증과 배포 경계

- Next 프런트는 GitHub Pages에만 배포, Spring API는 OCI VM의 공인 HTTPS 구조. Tailscale MagicDNS의 로컬 네트워크 권한 차단을 피하도록 공개 IP 인증서 적용. 공개·로그인·관리·초대 모두 Pages 주소 유지. Secure·HttpOnly·SameSite=None·Partitioned JDBC 세션과 지정 CORS 사용.
- Spring Session JDBC·MySQL 사용. Redis Cloud는 선택적 공개 본문 캐시만 사용, 기본 비활성.
- 기존 자동 검사와 변경된 권한·저장·오류 흐름 검증. 신규 테스트 코드 추가 없음.
- 기존 앱·DB 보존, 새 전용 MySQL 스키마와 OCI 객체/Redis 캐시 접두사로 실제 배포. 별도 PORT 문서 보존. 사용자용 학습 자료 삭제 유지.
- GitHub 공개 API 변수 설정, 운영 DB·Redis·OCI 접속값은 저장소 밖 보관. CI는 임시 MySQL을 사용하며 실제 운영 계정 불필요.

## 기록

- 커밋 author date와 실제 검증·push 날짜 구분. 이전 기능 author date2026-07-03, 실제 push2026-09-26.
- PR·강제 푸시·이력 재작성 없음. AGENTS.md·docs/study는 Git 제외.
