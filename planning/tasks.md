# 현재 작업

- 완료 계획: [P1-01 — MySQL·JPA·Flyway와 게시글 저장 기반](issues/P1-01.md).
- 상태: 구현·실제 MySQL 테스트·Buildpacks·Compose 재기동·main 반영·Pages 도면 배포 완료.
- 내부 초안 저장·ID 및 slug 조회 제공. 공개 게시글 HTTP API와 인증은 아직 없음.
- 구조: GitHub Pages의 Next 정적 화면, VM의 Spring API·개발 MySQL. 공개 API 도메인·HTTPS 주소 미정이며 공개 홈은 API 미설정 상태.

## 완료 조건

- [x] 환경변수 기반 DB 설정과 Flyway V1·JPA 스키마 검증.
- [x] 구체 Repository·Service, 제목·slug·본문 계약, 고유 제약과 원자적 롤백.
- [x] 실제 MySQL의 Kotlin 통합 테스트 21개, 실패·오류·건너뜀 0.
- [x] Buildpacks 이미지 생성과 API·MySQL Compose 기동·health 확인.
- [x] Compose 재기동 후 행·Flyway 이력 보존, 재마이그레이션 없음.
- [x] [CI](https://github.com/gjaku1031/ken-blog/actions/runs/36137705283) API·Web 성공.
- [x] [Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36137705417) 도면 배포 성공. 공개 SVG/PNG 4개와 로컬 산출물 일치.
- [x] 전용 검증 자원 정리·기존 서비스 유지·학습 문서 Git 제외.

실제 검증·push 날짜: 2026-09-25. 커밋 author date: 2026-05-24~2026-05-28. 세부 계약·검증·한계는 [P1-01](issues/P1-01.md), 실행 방법은 [게시글 저장 기반](../docs/persistence.md)에 기록.

Spring Security·Redis·OCI Object Storage·GA 연동과 게시글 화면은 후속 단계. 이전 P0-04의 API 메모리 수치는 MySQL·JPA 추가 전 기록으로, 현재 전체 블로그의 4GB 운영 적합성은 미검증.

## 다음 작업

[P1-02 — Spring Security·로그인과 Redis 세션](issues/P1-02.md). 계획 초안이며 별도 승인 전 구현 없음.

## 남은 결정

- 초기 로그인 계정 범위와 계정 준비 절차.
- 공개 Spring API의 도메인·HTTPS 제공 방식.
- 실제 프론트/API 도메인을 기준으로 한 쿠키·세션·CSRF 정책. 인증 단계에서 확정.
