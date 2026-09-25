# 현재 작업

- [P1-03 — OCI Object Storage 이미지 첨부 기반](issues/P1-03.md): 사용자 승인 범위의 구현·격리 검증·main 직접 push·CI·Pages 완료.
- 선행 [P1-02B](issues/P1-02B.md): JpaRepository 전환·도입 이력 정정·기존 28개 검사·main·CI·Pages 완료.
- 인증은 Spring Security·Spring Session JDBC·MySQL 유지. Redis Cloud는 후속 공개 데이터 캐시용.

## 이번 검증

- `-DskipTests clean package`와 Buildpacks 이미지 생성 성공. 신규 테스트 코드 없음. 기존 마이그레이션 검사의 기대 버전만 V4까지 변경.
- 격리 API·MySQL에서 실제 OCI PNG/JPEG 업로드 201, 메타데이터 조회·다운로드 바이트 일치, 삭제 204와 DB·객체 404 확인.
- 관리자 권한·CSRF·형식/크기/픽셀/이름·파일 개수 검사 확인. API 재시작 뒤 같은 세션과 다운로드 유지.
- 저장소 실패, DB 상태 갱신 실패, 미완료 업로드 상태를 각각 재현하고 추적 행 유지·정리 재시도 확인. 중단 상태와 유예 시간은 검증 DB 조작으로 구성한 조건.
- 검증 DB 연결 중단 시 30.0초 뒤 503 ProblemDetail, 복구 후 기존 세션 유지.
- Buildpacks 실행 이미지의 격리 Compose에서도 실제 업로드·다운로드·삭제 성공. Swagger multipart 경로 확인.
- 검증 객체·DB 행·API·MySQL·Compose 전용 볼륨 정리 완료. 라이트/다크 도면과 로컬 학습 문서 갱신.
- `e184799`의 [CI](https://github.com/gjaku1031/ken-blog/actions/runs/36169981879): 기존 API 28개·Web 7개, 빌드·HTTP 확인 성공. [Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36169981884) 배포 성공. 공개 홈 200·API 미설정 문구·도면 4개 바이트 일치 확인.
- Author date: 6월 3일 기능 2개, 6월 5일 문서 1개. 실제 검증·push: 2026-09-25 UTC(한국시간 9월 26일). 원격 결과 기록 커밋은 실제 날짜 사용.

## 실제 배포와의 구분

새 프로젝트의 소스·실행 이미지·격리 기능 검증까지 완료. 기존 VM의 `ken-blog-app-1`·`ken-blog-redis-1`은 교체하지 않았으며 ID·이미지 ID·시작 시각 동일, healthy 유지. Pages 반영은 정적 아키텍처 자산에 한정. 공개 API 도메인·HTTPS·프론트 로그인·업로드 화면 연결은 후속 범위.

## 다음 계획과 남은 결정

- [로드맵](roadmap.md)의 P1-04 공개 데이터 캐시는 별도 계획·승인 후 진행. 아직 없는 공개 글 API·공개 범위와의 순서도 계획 시 확인.
- 공개 Spring API 도메인·HTTPS 제공 방식과 쿠키·CSRF 연결.
- 게시글과 첨부 연결, 공개 이미지 제공 방식 및 프론트 에디터.
- 전체 블로그의 4GB 운영 적합성은 후속 실측 대상.

별도 `PORT-*` 계획은 이번 변경에서 제외하여 보존. 로컬 `docs/study/`와 `AGENTS.md`는 Git 제외 유지.
