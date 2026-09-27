# 현재 작업

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
