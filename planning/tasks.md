# 현재 작업

- P1-04A 관리자 초안 API: 구현·격리 검증·main·CI·Pages 완료. [상세](issues/P1-04A.md).
- 2026-09-26부터 남은 로드맵 자율 진행. 계획·검증·기능별 커밋·main 직접 push 유지. 학습 문서 추가/갱신 중단.
- 현재: [P1-04B 출간·공개 범위·권한별 조회](issues/P1-04B.md) main·CI·Pages 완료. [P1-04 공개 본문 캐시](issues/P1-04.md) main·CI·Pages 완료. [P1-05A Tech 분류·태그](issues/P1-05A.md) main `e147f10`·CI 36221577967·Pages 36221578032 완료. [P2-01 공통 화면·Tech 탐색·로그인](issues/P2-01.md) main `fa86abc`·CI 36223462342·Pages 36223462339 완료. [P2-02A 편집본 저장](issues/P2-02A.md) main `19b884a`·CI 36224536190·Pages 36224536203 완료. 현재 [P2-02B 기본 블록 편집·저장/출간 화면](issues/P2-02B.md) main `814715c`·CI 36226398228·Pages 36226398232 완료. [P2-02C 표 편집·안전한 접기 읽기](issues/P2-02C.md) main `01964c8`·CI·Pages 성공. [P2-02D 접기 블록 편집](issues/P2-02D.md) main `9dc415d`·CI 36229191294·Pages 36229191303 완료. [P2-03A 이미지 연결·권한별 전달](issues/P2-03A.md) main `5fd3e32`·CI 36230515666·Pages 36230515657 완료. 현재 [P2-03B 이미지 편집·읽기](issues/P2-03B.md) main `ea3a948`·CI 36231915608·Pages 36231915594 완료. 현재 [P2-04A 코드 블록](issues/P2-04A.md) main `94d331d`·CI 36232880765·Pages 36232880774 완료. 현재 [P2-04B 수식](issues/P2-04B.md) main `d4d291d`·CI 36234501388·Pages 36234501381 완료. 현재 [P2-04C Mermaid](issues/P2-04C.md) main `37206ca`·CI 36235981712·Pages 36235981716 완료. 현재 [P2-05A 번호·이름 주석 읽기](issues/P2-05A.md) 구현·격리 검증 완료, main 반영 전. 이후 Tech 분류·태그·화면·Projects/Notes·에디터·운영 검증 순차 진행. [전체 전달 체크리스트](delivery-checklist.md)의 기능은 완료 증거가 있을 때만 완료 표시.

## 검증 경계

- P1-04A 기존 API 검사 28개, 실제 CRUD·권한·CSRF·본문 제외 SQL·중복 수정 롤백·입력 오류·재시작 후 세션·DB 장애/복구·로그아웃 확인. 최종 이미지의 Swagger 필수 문자열·누락/null 400과 CRUD 확인.
- 신규 테스트 코드 없음. 검증 자원 정리, 기존 VM 앱·Redis 컨테이너 유지. 실제 배포 교체 없음.
- Redis Cloud의 선택적 공개 본문 캐시 격리 검증 완료, 기본 비활성. 세션은 MySQL. 프론트는 GitHub Pages 정적 Next. 공개 HTTPS API/도메인·브라우저 인증 연결은 미완료.
- 기존 P1-03 완료 기록: [계획](issues/P1-03.md), [CI](https://github.com/gjaku1031/ken-blog/actions/runs/36170394567), [Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36170394599).

## 보호 대상

별도 PORT-* 작업·기존 배포·외부 비밀 설정 보존. AGENTS.md·docs/study는 Git 제외. author date와 실제 검증·push 날짜 구분.
