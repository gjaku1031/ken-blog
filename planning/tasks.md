# 현재 작업

- 현재 계획: [P0-02 — API 오류 응답과 Swagger 계약](issues/P0-02.md).
- 상태: 완료·main 반영·CI 통과.
- 선행 [P0-01](issues/P0-01.md)의 최소 앱 구성 유지.

## 완료 조건

- [x] `GET /api/v1/status`와 Swagger 명세 인터페이스·Controller 구현.
- [x] RFC 9457 오류 응답과 Spring 기본 상태·헤더 보존.
- [x] Kotlin 통합 테스트 12개와 패키징한 JAR HTTP 검증.
- [x] [GitHub CI](https://github.com/gjaku1031/ken-blog/actions/runs/36128207135)의 API·Web 작업 통과.
- [x] 로컬 학습 자료와 비밀 설정의 Git 제외 유지.

실제 검증·push 날짜: 2026-09-25. 커밋 지정 날짜: 2026-05-06~2026-05-10. 자세한 변경 단위와 검증 범위는 [P0-02](issues/P0-02.md)에 기록.

현재 구현은 최소 홈·API 상태 조회·오류 응답·Swagger. Next와 API 연결, DB·JPA·Spring Security·Redis·OCI Object Storage·GA·Buildpacks·Compose·GitHub Pages는 아직 구현하지 않음.

## 다음 작업

[P0-03 — Next 화면과 상태 API 연결](issues/P0-03.md). 계획 초안이며 별도 승인 전 구현 없음.
