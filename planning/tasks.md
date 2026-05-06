# 현재 작업

- 현재 계획: [P0-02 — API 오류 응답과 Swagger 계약](issues/P0-02.md).
- 상태: P0-02 승인·구현 진행 중. 아래 완료 조건은 선행 P0-01 결과.
- 빈 `apps/web`·`apps/api`에서 새 앱 구성. 기존 앱의 이전·복사 없음.
- 기존 저장소 이력·미커밋 작업·학습 자료는 별도 로컬 백업 완료.
- 환경변수·비밀 설정은 저장소 외부에서 보존.

## 완료 조건

- [x] web 잠금 파일·타입 검사·빌드·기동 확인.
- [x] api Maven 빌드·상태 확인.
- [x] 새 Git 이력과 공개 저장소 반영.
- [x] GitHub CI의 두 앱 빌드·기동 확인.
- [x] 로컬 학습 자료와 비밀값의 Git 제외 확인.

검증일: 2026-09-25. [CI 실행 결과](https://github.com/gjaku1031/ken-blog/actions/runs/36126854555) 확인. API 테스트 소스는 아직 없으며 빌드와 HTTP 상태 응답 검증 완료.

현재 구현은 최소 홈과 API 기동 기반. DB·JPA·Spring Security·Redis·OCI Object Storage·Swagger·GA·Buildpacks·Compose·GitHub Pages는 아직 구현하지 않음.

## 다음 작업

[P0-02](issues/P0-02.md)의 API 오류 응답·Swagger 계약 계획 검토. 별도 승인 전 구현 없음.
