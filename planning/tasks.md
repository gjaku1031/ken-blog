# 현재 작업

- 2026-09-27 최신 요청으로 전체 구현 재개. 단일 폴더의 P3-01 미완성 변경을 보존하고 Projects·Notes·홈·검색·관리·회원·분석·운영 구성을 통합 전달. 단계별 중단과 작은 단위 전달 대기 없음.
- 사용자용 README·docs·학습 문서 삭제. 구현 규칙은 `planning/code-conventions.md`, 운영 도구 안내는 `planning/reference/`로 이동. 프로젝트 백업/작업 사본 정리, 별도 PORT 작업 보존.

- 2026-09-27 남은 프로젝트 끝까지 자율 진행 재확인. 계획·검증·기능별 커밋·main 직접 push 유지, 단계별 승인 대기와 학습 문서 추가 없음.
- 구현 완료: Projects·Notes·Home·검색·시리즈·핀·조회·전체 관리 화면·초대·GA 연동 코드·운영 이미지/복원 도구. [통합 검증 기록](issues/DELIVERY-2026-09-27.md)에 실제 결과와 외부 조건 유지.
- 현재: 최종 브라우저 확인 완료, 통합 커밋·main 반영 및 해당 SHA의 CI/Pages 확인. 실제 원격 상태는 Git과 Actions 기준. 상세 수용 기준은 [전체 체크리스트](delivery-checklist.md), 이전 단계는 [로드맵](roadmap.md)과 개별 계획에 보관.

## 검증과 배포 경계

- Next는 GitHub Pages 정적 출력, Spring API는 별도 VM 구조. 공개 HTTPS API/도메인과 공개 Pages의 로그인 연결은 아직 미설정. 격리 검증을 운영 연결 완료로 표시하지 않음.
- Spring Session JDBC·MySQL 사용. Redis Cloud는 선택적 공개 본문 캐시만 사용, 기본 비활성.
- 기존 자동 검사와 변경된 권한·저장·오류 흐름 검증. 신규 테스트 코드 추가 없음.
- 실제 운영 앱·DB·Redis 교체 없음. 별도 PORT 문서·외부 비밀 설정 보존. 사용자용 학습 자료 삭제.
- GitHub 저장소/Pages 환경의 Secrets·Variables는 현재 비어 있음. 운영 DB·Redis 접속값은 저장소 밖 로컬 설정에 보관. CI는 임시 MySQL을 사용하며 실제 운영 계정 불필요.

## 기록

- 커밋 author date와 실제 검증·push 날짜 구분. 이전 기능 author date2026-07-03, 실제 push2026-09-26.
- PR·강제 푸시·이력 재작성 없음. AGENTS.md·docs/study는 Git 제외.
