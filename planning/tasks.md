# 현재 작업

- 현재 계획: [P0-03 — Next 화면과 상태 API 연결](issues/P0-03.md).
- 상태: 완료·main 반영·CI 통과.
- Next 서버에서 Spring 상태 조회, 홈의 정상·실패 안내 표시.

## 완료 조건

- [x] 서버 전용 API 주소와 요청 시점의 상태 조회.
- [x] 3초 대기 제한·캐시 미사용·응답 계약 검증.
- [x] Web 테스트 6개·타입 검사·API 미설정 빌드 통과.
- [x] 실제 두 앱의 정상 연결 및 API 중지 상태 브라우저 확인.
- [x] API 중지 상태 HTML·RSC 및 클라이언트 JS의 내부 주소 미포함 확인.
- [x] [GitHub CI](https://github.com/gjaku1031/ken-blog/actions/runs/36129596739) API·Web 작업 통과.
- [x] 로컬 학습 자료 Git 제외와 임시 서버 종료 확인.

실제 검증·push 날짜: 2026-09-25. 커밋 지정 날짜: 2026-05-11~2026-05-15. 검증 범위와 한계는 [P0-03](issues/P0-03.md)에 기록.

현재 구현은 Next 홈의 API 상태 조회와 Spring의 오류 응답·Swagger. DB·JPA·Spring Security·Redis·OCI Object Storage·GA·Buildpacks·Compose·GitHub Pages는 아직 구현하지 않음.

## 다음 작업

[P0-04 — 실행 이미지·개발 환경·문서 대문](issues/P0-04.md). 계획 초안이며 별도 승인 전 구현 없음.
