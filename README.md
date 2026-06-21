# Ken Blog

Next.js·TypeScript 정적 프론트와 Kotlin·Spring Boot API를 함께 관리하는 저장소.

```text
apps/
├── web/       # GitHub Pages에 배포할 정적 프론트
└── api/       # VM에서 실행할 Spring API
planning/      # 계획·완료 조건·진행 상태
docs/          # 실행·설계 안내
```

백엔드 패키지는 기능과 역할 기준으로 구성.

```text
io.github.gjaku1031.kenblog
├── KenBlogApiApplication.kt
├── post/       # controller · dto · domain · repository · service
├── draft/      # 관리자 편집본 controller · dto · domain · repository · service
├── category/   # controller · dto · domain · repository · service
├── account/    # domain · repository · service · bootstrap
├── auth/       # controller · dto · service
├── attachment/ # controller · dto · domain · repository · service · storage
├── status/     # controller · dto
└── global/     # config · security · error
```

`post/repository`·`category/repository`·`account/repository`·`attachment/repository`는 Spring Data JPA의 `JpaRepository` 인터페이스를 사용. 업무 흐름과 트랜잭션을 담당하는 Service는 구체 클래스로 유지하고, Swagger Controller 계약은 별도 인터페이스로 선언.

프론트는 GitHub Pages에서 제공하고 브라우저가 Spring API를 호출하는 구조. VM에는 Spring 실행. 공개 API 도메인·HTTPS 주소가 아직 없어 공개 홈은 API 미설정 상태로 배포.

- [정적 프론트와 아키텍처 도면](https://gjaku1031.github.io/ken-blog/)
- [현재 계획](planning/issues/P2-02B.md) · [작업 상태](planning/tasks.md) · [개발 순서](planning/roadmap.md)
- [코드·문서 규칙](docs/code-conventions.md) · [런타임 안내](docs/runtime.md) · [게시글 API](docs/posts.md) · [관리자 편집본 API](docs/editor-drafts.md) · [관리자 편집 화면](docs/editor.md) · [Tech 분류·태그](docs/taxonomy.md) · [선택적 공개 본문 캐시](docs/cache.md) · [첨부파일 운영 안내](docs/attachments.md) · [도면 설명](docs/architecture.md)

## API 직접 실행

필요 환경: JDK 25·Docker와 MySQL 연결 설정. Spring Boot 4.1.1·Kotlin 2.3.21·Maven wrapper 사용.

DB 준비와 환경변수 주입은 [게시글 저장 기반 실행 안내](docs/persistence.md) 참고. 기존 검증 구성은 격리된 MySQL 컨테이너 사용. 로그인 준비와 세션 쿠키 설정은 [인증 실행 안내](docs/authentication.md), 초안·출간과 권한별 조회 계약은 [게시글 API](docs/posts.md), 선택적인 Redis Cloud는 [공개 본문 캐시 안내](docs/cache.md), OCI Object Storage 설정은 [첨부파일 운영 안내](docs/attachments.md) 참고.

```bash
cd apps/api
./mvnw -B clean verify
SERVER_ADDRESS=127.0.0.1 SERVER_PORT=8081 ./mvnw spring-boot:run
```

아래 출간·공개 글 경로는 P1-04B에서 구현·격리 검증하고 main·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36218470775)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36218470745)에 반영 완료. P1-04 공개 본문 캐시는 같은 상세 경로의 선택적 내부 처리이며 새 HTTP 경로 없음.

| 경로 | 제공 내용 |
|---|---|
| `/actuator/health` | 기동 상태 |
| `/api/v1/status` | `{"status":"UP"}` 응답. DB·외부 서비스 점검 포함 없음 |
| `/v3/api-docs` | OpenAPI 명세 JSON |
| `/swagger-ui/index.html` | Swagger UI |
| `/api/v1/auth/csrf` | 세션 CSRF 토큰 발급 |
| `/api/v1/auth/login` | 쿠키·CSRF 검증 후 로그인 및 세션 ID 교체 |
| `/api/v1/auth/me` | 현재 로그인 계정 조회 |
| `/api/v1/auth/logout` | 인증·CSRF 검증 후 세션 무효화 |
| `POST /api/v1/admin/posts` | 관리자 초안 생성, `201`과 관리자 상세 Location. CSRF 필요 |
| `GET /api/v1/admin/posts` | 초안·출간 글의 본문 없는 관리자 요약 목록과 페이지 정보 |
| `GET /api/v1/admin/posts/{id}` | 초안·출간 글의 관리자 상세와 원문 본문 |
| `PUT /api/v1/admin/posts/{id}` | 초안·출간 글의 본문 전체 교체. CSRF 필요 |
| `DELETE /api/v1/admin/posts/{id}` | 게시글 행 삭제, `204`. CSRF 필요 |
| `POST /api/v1/admin/posts/{id}/publish` | 관리자 출간·재출간. `visibility`와 CSRF 필요 |
| `POST /api/v1/admin/posts/{id}/unpublish` | 관리자 출간 철회. CSRF 필요 |
| `PATCH /api/v1/admin/posts/{id}/visibility` | 관리자 공개 범위 변경. `visibility`와 CSRF 필요 |
| `GET /api/v1/posts` | 출간된 글의 권한별 목록·건수, 본문 제외 |
| `GET /api/v1/posts/{slug}` | 출간된 글 상세 또는 익명 비공개 잠금 메타데이터 |
| `/api/v1/admin/attachments` | 관리자 이미지 1개 업로드. 세션·ADMIN 역할·CSRF 필요 |
| `/api/v1/admin/attachments/{id}` | 관리자 첨부 메타데이터 조회·삭제. 삭제에는 CSRF 필요 |
| `/api/v1/admin/attachments/{id}/content` | READY 이미지의 관리자 다운로드 |

P1-05A에서 추가한 경로는 관리자 분류 생성·전체 트리·부모 이동 삭제(`/api/v1/admin/categories`), 글 분류·태그 전체 교체(`/api/v1/admin/posts/{id}/taxonomy`), 공개 권한별 분류·태그 집계(`/api/v1/categories`, `/api/v1/tags`), 관리자 태그 자동완성(`/api/v1/admin/tags`). 기존 공개 글 목록에는 선택적 `categoryId`·`tag` 필터 추가. 입력·권한·삭제·공개 개수 규칙과 2026-09-26 격리 JAR HTTP·SQL·캐시 활성 호환 검증 범위는 [Tech 분류·태그 계약](docs/taxonomy.md)에 기록. main `e147f10`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36221577967)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36221578032) 반영 완료.

P2-02A는 `/api/v1/admin/editor-drafts`에 수동 저장 편집본을 별도로 제공. 기존 게시글 `DRAFT`와 달리 편집본 저장은 공개 원문을 바꾸지 않고, `revision`과 원본 `updatedAt`을 확인한 성공 출간에서만 게시글 반영과 편집본 제거를 원자적으로 수행. Flyway V8·ADMIN 세션/CSRF·명시된 인증 origin의 자격 증명 CORS·`no-store`를 포함. 2026-09-26 기존 검사 28개와 격리 JAR HTTP의 저장·경합·출간·롤백·CORS·DB 장애/복구 검증 후 main `19b884a`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36224536190)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36224536203) 반영 완료. 상세 계약과 인위적 실패 주입의 경계는 [관리자 편집본 API](docs/editor-drafts.md) 참고.

상태 API 명세는 `StatusApi`, 구현은 `StatusController`에서 관리. Spring MVC 오류는 `ApiErrorHandler`의 RFC 9457 `ProblemDetail`로 처리. MySQL·JPA·Flyway와 관리자 게시글 초안 CRUD, 출간 상태·권한별 읽기 API 제공. P1-04B와 P1-05A는 main·CI·Pages 반영 완료. P1-04의 익명 PUBLIC 상세 본문용 선택적 Redis Cloud 캐시는 2026-09-26 격리 JAR·Buildpacks/Compose 검증 후 main `2ca2169`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36220258568)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36220258654) 반영 완료. 기본값은 비활성이며 Spring Session JDBC 로그인과 MySQL 세션을 유지. 관리자 첨부 API는 이미지 원본을 비공개 OCI Object Storage에, 상태·소유자 등 메타데이터를 MySQL에 보관. P2-01의 Tech 탐색·로그인 화면은 로컬 Chrome 기능·장애·접근성 및 API 주소 미설정 빌드 검증 후 main `fa86abc`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36223462342)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36223462339) 반영 완료. P2-02A 편집본 API도 main·CI·Pages 반영 완료. 공개 HTTPS API 주소와 실사이트 로그인 연결은 아직 없음.

## 정적 프론트 빌드

필요 환경: Node.js 24.21.0·npm 11.19.0.

```bash
cd apps/web
npm ci
npm test
npm run typecheck
NEXT_PUBLIC_BASE_PATH=/ken-blog NEXT_PUBLIC_API_BASE_URL= npm run build
```

`out/`을 정적 호스팅에 게시. GitHub Actions도 같은 정적 산출물을 Pages에 배포하며 Next 서버는 실행하지 않음. 공개 API 주소를 비운 빌드에서 Home·Tech·글 상세는 미설정 안내를 표시하며 실제 글 0건으로 처리하거나 API에 요청하지 않음을 로컬에서 확인.

`NEXT_PUBLIC_API_BASE_URL`은 브라우저가 접근할 공개 API 주소. 빌드 시 JavaScript에 포함되므로 비밀값 저장 금지. 현재 공개 배포에는 설정하지 않음. HTTPS Pages에서 HTTP API 호출은 허용하지 않으며 실제 API의 HTTPS 준비 후 주소를 설정하고 다시 빌드해야 함.

`NEXT_PUBLIC_BASE_PATH`는 프로젝트 하위 경로이며 Pages 배포 값은 `/ken-blog`. 환경변수 예시는 [apps/web/.env.example](apps/web/.env.example), 로컬 정적 서버·API 연결 및 CORS 확인 절차는 [런타임 안내](docs/runtime.md) 참고.

P2-01에서 정적 `/tech/`, `/post/?slug=...`, `/login/` 화면과 공통 헤더·푸터·라이트/다크 테마를 구현. Noto Sans KR·IBM Plex Mono를 사용하며 Projects/Notes는 준비 화면. Pages의 `/ken-blog` basePath와 끝 슬래시 경로를 유지하고, 글 주소는 정적 `/post/` 페이지의 `slug` 쿼리로 선택. Home/Tech는 실제 공개 목록·분류·태그 API로 10개씩 조회하고 추가 로드·URL 필터·로딩·빈 결과·API 미설정·통신 실패를 구분. 글 상세는 읽기 전용 기본 Markdown/GFM을 표시하고 raw HTML 실행과 외부 이미지 자동 요청을 제외하며 할 일 항목은 읽기 전용. 로그인 화면은 로컬 JDBC 세션 API의 CSRF→로그인→현재 사용자→로그아웃 흐름에 연결하고 쿠키·토큰의 브라우저 영구 저장 없음. 2026-09-26 정적 빌드·타입 검사와 기존 npm 검사 7개, Chrome의 탐색·본문·로그인·로그아웃·세션 만료·늦은 응답 폐기·API 장애 복구·API 주소 미설정 안내 통과. 주요 화면의 라이트·다크 접근성 검사 8회 위반 0건. main·CI·Pages 반영 완료. 관리자 편집, 검색·GA·공개 이미지와 고급 Markdown은 후속 범위.

P2-02B는 정적 `/write/`에서 새 글·기존 글·저장된 편집본을 이어 쓰고, `/admin/drafts/`에서 편집본을 조회·삭제하는 관리자 화면. 기본 블록 편집과 명시적 수동 저장, 저장된 revision을 이용한 출간을 [관리자 편집 화면](docs/editor.md)에 정리. 2026-09-26 기존 API 검사 28개·웹 검사 7개·타입 검사·정적 빌드 통과. 격리 Chrome에서 새 글 저장→새로고침→출간, 기존 공개 원문과 미지원 Markdown 원문 보존, 저장 중 추가 입력·충돌·CSRF 거부·세션 만료·늦은 응답, 목록 페이지·삭제와 키보드·화면 너비를 확인. 격리 MySQL·API 중단에서 입력 유지와 복구 후 저장도 확인. API 주소 미설정 별도 빌드에서도 관리자 화면 안내·요청 0건·가짜 데이터 없음 확인. main·CI·Pages 반영 전. 공개 Pages의 API 주소는 여전히 비어 있어 실사이트 관리자 작성·출간 연결도 미완료.

## Spring 컨테이너와 배포 범위

Spring API 이미지는 Buildpacks로 생성. 개발 Compose는 API·MySQL을 실행하며 Web Docker 구성 없음. 포트는 로컬 주소에만 연결. 이 구성은 새 프로젝트의 격리 검증용이며 기존 VM 앱·Redis를 교체한 상태가 아님. 공개 HTTPS API 배포는 아직 수행하지 않음.

Pages의 아키텍처 도면 자산은 유지. P2-01 화면 추가 후에도 공개 API 배포와 브라우저 첨부 UI 연결은 후속 단계이고, 공개 Pages의 API 주소는 계속 미설정. 로그인 화면의 정적 제공과 실사이트 로그인 성공은 별도 상태.

[도면 설명과 원본](docs/architecture.md)은 정적 프론트 배포, 로컬 MySQL 게시글·계정·세션·첨부 메타데이터, 비공개 OCI Object Storage의 관리자 첨부 경로, 선택적 Redis Cloud 공개 본문 캐시와 후속 공개 HTTPS 연결을 구분.

## 검증 기록

계획별 실제 빌드·테스트·브라우저·CI 결과는 [작업 상태](planning/tasks.md)에서 확인. 메모리 사용량은 [런타임 안내](docs/runtime.md)의 측정 조건과 함께 해석.

실제 환경 파일과 `docs/study/`는 Git 및 Pages 산출물에서 제외. 게시글과 첨부의 연결·공개 이미지·GA 연동과 공개 HTTPS API 연결은 후속 단계. P1-04B API의 출간·공개 조회는 main 반영 완료이나 운영 API 배포와 Pages의 실제 데이터 연결은 수행하지 않음. P1-04 캐시의 실제 확인 범위는 [계획](planning/issues/P1-04.md)과 [캐시 안내](docs/cache.md) 참고.
