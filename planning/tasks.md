# 현재 작업

- 완료 계획: [P1-02A — 로그인 세션 저장소를 MySQL로 전환](issues/P1-02A.md).
- 상태: **구현·격리 HTTP 검증·Buildpacks·main·CI·Pages 반영 완료.**
- 인증은 Spring Security 서버 세션, 저장은 Spring Session JDBC·MySQL. JWT 도입 없음. 새 프로젝트의 내부 Redis 제거.
- 로그인·로그아웃·현재 사용자·CSRF·세션 ID 교체·권한·ProblemDetail 계약 유지. 30분 비활동 만료와 매분 정리.

## 검증 결과

- 로컬 `-DskipTests clean package` 성공. 기존 테스트 컴파일만 수행하고 실행은 생략.
- 격리 MySQL·실행 JAR의 실제 HTTP 로그인·CSRF·세션 ID 교체·로그아웃·이전 쿠키 거부 확인.
- API만 재시작한 뒤 같은 쿠키의 로그인 유지. 검증 DB 중단 시 인증 경로 3곳 503 ProblemDetail, 복구 후 정상 응답 확인. 기본 연결 대기 약 30초.
- 시험 만료 세션의 인증 거부 확인. 별도로 HTTP 조회하지 않은 만료 세션·속성 행이 약 58초 뒤 자동 정리됨.
- Buildpacks 이미지와 API·MySQL만의 격리 Compose 기동 성공.
- [원격 CI](https://github.com/gjaku1031/ken-blog/actions/runs/36151614912): API·Web 성공, 기존 검사 28개 통과. 신규 테스트 추가 없음.
- [Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36151614758): 배포 성공. 공개 홈 HTTP 200·API 주소 미설정, JDBC 도면 4개 로컬 산출물과 일치.
- 검증 자원 정리 완료. 학습 자료 `docs/study/`는 Git 제외 유지.

## 실제 배포와의 구분

새 프로젝트는 소스·이미지·격리 실행 검증까지 완료. 기존 VM의 `ken-blog-app-1`·`ken-blog-redis-1`은 교체하지 않았으며 작업 전후 ID·시작 시각·이미지 동일, 둘 다 healthy. 공개 Pages만 새 도면으로 갱신. 공개 API HTTPS·도메인·프론트 로그인 연결은 별도 후속 범위.

실제 검증·push 날짜는 2026-09-25. 이번 author date는 2026-06-01의 기능·도면 2개 커밋과 2026-06-02의 문서 커밋으로 구분. 상세 기록은 [P1-02A](issues/P1-02A.md).

## 다음 작업

[P1-03 — OCI Object Storage 이미지 첨부 기반](issues/P1-03.md). 계획 초안이며 사용자 승인 전 구현 없음. Redis Cloud는 후속 공개 데이터 캐시 계획만 유지.

## 남은 결정

- 공개 Spring API의 도메인·HTTPS 제공 방식과 프론트 쿠키·CSRF 연결.
- OCI Object Storage 버킷·인증 수단과 이미지 다운로드 권한.
- 전체 블로그의 4GB 운영 적합성은 후속 실측 대상.
