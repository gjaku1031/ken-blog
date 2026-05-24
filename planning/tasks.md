# 현재 작업

- 진행 계획: [P1-01 — MySQL·JPA·Flyway와 게시글 저장 기반](issues/P1-01.md).
- 사용자 승인 확인, 구현·실제 MySQL 검증 진행 중. 아래 P0-04는 선행 완료 기록.


- 완료 계획: [P0-04 — 정적 프론트 Pages 배포와 Spring 실행 이미지](issues/P0-04.md).
- 상태: 구현·로컬 검증·main 반영·Pages 배포 완료.
- 구조: GitHub Pages의 Next 정적 화면, 브라우저에서 Spring API 호출. VM의 Next 서버·Web 컨테이너 없음.
- 공개 API 도메인·HTTPS 주소 미정. 공개 홈은 API 미설정 안내이며 실제 API 연결은 후속 항목.

## 완료 조건

- [x] `/ken-blog` 정적 출력과 브라우저의 정상·미설정·오류 안내.
- [x] API Buildpacks JVM 이미지·API 단독 Compose·지정 origin의 CORS.
- [x] Kotlin API 테스트 15개, Web 테스트 7개·타입 검사·정적 빌드.
- [x] 로컬 브라우저의 정상·API 중지·주소 미설정 흐름.
- [x] 공식 아이콘 도면 라이트·다크 SVG/PNG와 홈 표시.
- [x] [CI](https://github.com/gjaku1031/ken-blog/actions/runs/36133002373) API·Web 통과.
- [x] [Pages 배포](https://github.com/gjaku1031/ken-blog/actions/runs/36133002372) 성공, [공개 홈](https://gjaku1031.github.io/ken-blog/)·JS·도면 HTTP 200.
- [x] 공개 산출물의 내부 파일 제외, 검증용 컨테이너·임시 서버 정리.

실제 검증·push 날짜: 2026-09-25. 커밋 author date: 2026-05-17~2026-05-22. 세부 변경과 검증 한계는 [P0-04](issues/P0-04.md)에 기록.

현재 API는 상태 조회·ProblemDetail·Swagger·CORS 제공. DB·JPA·Spring Security·Redis·OCI Object Storage·GA 연동 없음. API 한 개의 메모리 표본은 약 185~192 MiB이며 전체 블로그의 4GB 운영은 미검증.

## 다음 작업

[P1-01 — MySQL·JPA·Flyway와 게시글 저장 기반](issues/P1-01.md). 승인됨. 현재 구현 중.

## 남은 결정

- 공개 Spring API의 도메인·HTTPS 제공 방식.
- 실제 프론트/API 도메인을 기준으로 한 로그인 쿠키·세션·CSRF 정책. 인증 단계에서 확정.
