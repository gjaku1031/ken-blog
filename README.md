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
- [현재 계획](planning/issues/P2-06C.md) · [작업 상태](planning/tasks.md) · [개발 순서](planning/roadmap.md)
- [코드·문서 규칙](docs/code-conventions.md) · [런타임 안내](docs/runtime.md) · [게시글 API](docs/posts.md) · [관리자 편집본 API](docs/editor-drafts.md) · [관리자 편집 화면](docs/editor.md) · [Markdown 읽기](docs/markdown.md) · [위키 제목 조회 API](docs/wiki-links.md) · [Tech 분류·태그](docs/taxonomy.md) · [선택적 공개 본문 캐시](docs/cache.md) · [첨부파일 운영 안내](docs/attachments.md) · [도면 설명](docs/architecture.md)

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
| `GET /api/v1/posts/{postId}/attachments/{id}/content` | 현재 글 상태·권한·연결을 확인한 뒤 비공개 OCI 원본을 Spring 경유로 제공. 없는·미허용 연결은 `404` |
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

P2-01에서 정적 `/tech/`, `/post/?slug=...`, `/login/` 화면과 공통 헤더·푸터·라이트/다크 테마를 구현. Noto Sans KR·IBM Plex Mono를 사용하며 Projects/Notes는 준비 화면. Pages의 `/ken-blog` basePath와 끝 슬래시 경로를 유지하고, 글 주소는 정적 `/post/` 페이지의 `slug` 쿼리로 선택. Home/Tech는 실제 공개 목록·분류·태그 API로 10개씩 조회하고 추가 로드·URL 필터·로딩·빈 결과·API 미설정·통신 실패를 구분. 글 상세는 읽기 전용 기본 Markdown/GFM을 표시하고 raw HTML 실행과 외부 이미지 자동 요청을 제외하며 할 일 항목은 읽기 전용. 로그인 화면은 로컬 JDBC 세션 API의 CSRF→로그인→현재 사용자→로그아웃 흐름에 연결하고 쿠키·토큰의 브라우저 영구 저장 없음. 2026-09-26 정적 빌드·타입 검사와 기존 npm 검사 7개, Chrome의 탐색·본문·로그인·로그아웃·세션 만료·늦은 응답 폐기·API 장애 복구·API 주소 미설정 안내 통과. 주요 화면의 라이트·다크 접근성 검사 8회 위반 0건. main·CI·Pages 반영 완료. 관리자 편집은 P2-02B에서 추가됐고, 검색·GA·공개 이미지와 고급 Markdown의 다른 기능은 후속 범위.

P2-02B는 정적 `/write/`에서 새 글·기존 글·저장된 편집본을 이어 쓰고, `/admin/drafts/`에서 편집본을 조회·삭제하는 관리자 화면. 기본 블록 편집과 명시적 수동 저장, 저장된 revision을 이용한 출간을 [관리자 편집 화면](docs/editor.md)에 정리. 2026-09-26 기존 API 검사 28개·웹 검사 7개·타입 검사·정적 빌드 통과. 격리 Chrome에서 새 글 저장→새로고침→출간, 기존 공개 원문과 미지원 Markdown 원문 보존, 저장 중 추가 입력·충돌·CSRF 거부·세션 만료·늦은 응답, 목록 페이지·삭제와 키보드·화면 너비를 확인. 격리 MySQL·API 중단에서 입력 유지와 복구 후 저장도 확인. API 주소 미설정 별도 빌드에서도 관리자 화면 안내·요청 0건·가짜 데이터 없음 확인. main `814715c`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36226398228)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36226398232) 반영 완료. 공개 Pages의 API 주소는 여전히 비어 있어 실사이트 관리자 작성·출간 연결도 미완료.

P2-02C에서는 GFM 표의 셀 단위 편집과 명시적인 `<details>`·`<summary>`의 안전한 읽기 표시를 확장. 불명확한 접기 문법은 HTML을 실행하지 않는 원문 표시로 돌리는 계약은 [Markdown 읽기](docs/markdown.md) 참고. 2026-09-26 격리 브라우저에서 표 생성·수정·저장·재열기·출간, 중첩 접기와 원문 보존, 지연 저장 응답 중 편집본 경로 전환을 확인. 최종 소스의 설정된 빌드와 API 주소 미설정 정적 빌드 통과. 검사한 읽기·관리자 편집 화면의 라이트·다크 Axe 위반 0건이며 원문 코드 블록의 키보드 스크롤, 두 표의 이동 후 셀 초점·저장 복원도 확인. API 미설정 브라우저에서는 Home·글쓰기·편집본 목록의 안내, API 요청 0건·가짜 원고 0건 확인. 전체 접근성 완료 선언은 아님. main `01964c8`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36228126312)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36228126314) 반영 완료. 공개 Pages의 API HTTPS 주소는 여전히 미설정.

P2-02D는 한 단계의 명확한 접기를 제목과 내부 문서로 편집하고 그룹째 이동·삭제·해제하는 기능. 중첩·속성·닫힘이 불명확한 접기는 원문 보존 유지. `> `·`/접기`·`/toggle` 생성, 바로 아래 텍스트 입력 블록의 Tab 편입·내부 텍스트 입력 블록의 Shift+Tab 꺼내기와 표·원문 블록용 이동 버튼은 [관리자 편집 화면](docs/editor.md) 참고. 2026-09-26 최종 소스의 타입 검사·기존 웹 검사 7개·API 설정 및 미설정 정적 빌드 통과. 격리 브라우저에서 접기 생성·그룹 이동·저장·재열기·출간과 원문 보존을 확인했고, 검사한 글쓰기 화면은 라이트·다크 일곱 너비에서 넘침 및 Axe 위반 0건. 내부 표 셀의 Tab은 다음 셀로 이동하고 접기 밖으로 나가지 않았음. API 미설정 브라우저의 Home·글쓰기·편집본 목록 안내, API 호출 0건·가짜 데이터 0건 확인. main `9dc415d`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36229191294)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36229191303) 반영 완료. 공개 Pages의 API HTTPS 연결은 여전히 없음.

P2-03A는 관리자 게시글·편집본에 이미지 ID를 명시적으로 연결하고, Spring이 현재 글 권한을 확인해 비공개 OCI Object Storage 원본을 전달하는 API 작업. Flyway V9 관계, 기존 글·편집본 수정에서 `attachmentIds` 생략 시 연결 보존, 명시적 빈 배열의 연결 해제, 연결 중인 첨부 삭제 거부를 구현. 권한별 이미지 GET은 글 ID와 첨부 ID를 사용하며 공개 API HTTPS와 브라우저 이미지 입력·표시는 이 단계에서 제공하지 않음. [첨부 계약](docs/attachments.md)과 [계획](planning/issues/P2-03A.md) 참고. 2026-09-26 격리 Maven 기존 API 검사 28개와 웹 검사 7개·타입 검사·정적 빌드 통과. 기존 V8 데이터와 JDBC 세션을 V9로 보존했고 실제 OCI PNG/JPEG 바이트 일치·권한별 읽기·연결/삭제 경합·편집본 출간 전환을 HTTP/SQL로 확인. 격리 MySQL 장애의 이미지 `503`·복구 뒤 동일 세션 유지와 새 DB의 V1~V9 기동·로그인·글 생성까지 확인. 검증 소유 글·편집본·첨부/OCI 객체와 JAR·MySQL 컨테이너·볼륨 정리 완료. 기존 VM 앱·Redis의 ID·이미지·시작 시각은 유지. main `5fd3e32`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36230515666)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36230515657) 반영 완료.

P2-03B는 정적 관리자 글쓰기의 JPEG/PNG 파일 선택·드롭·붙여넣기와 이미지 블록 편집, 글 읽기의 권한별 내부 이미지를 연결하는 정적 화면 작업. 본문에는 `attachment:<ID>`와 설명·너비·정렬만 기록하고 저장 요청의 명시적 `attachmentIds` 목록으로 글별 열람 권한을 관리. 문서에서 이미지를 지워 목록에서도 제외하면 글별 권한이 해제되지만 OCI 원본은 자동 삭제하지 않음. 외부 이미지 URL 자동 요청·버킷 직접 접속은 계획하지 않음. [편집 흐름](docs/editor.md)·[Markdown 이미지 규칙](docs/markdown.md) 참고. 2026-09-26 완료한 격리 검증에서 기존 원문 316개·이미지 자료 18개·웹 검사 7개·타입 검사·API 설정 정적 빌드와 실제 OCI 파일 선택/격리 클립보드 붙여넣기/합성 파일 드롭, 저장·재열기·출간·권한별 읽기를 확인. 지연 업로드 취소·경로 변경, 주입한 `503`·CSRF `403`의 입력 유지/재시도, 세션 만료 후 서버 편집본 복원, 일곱 너비 라이트·다크 넘침 0·검사한 네 화면 Axe 위반 0건 확인. API 미설정 별도 빌드는 API 요청·가짜 이미지 0건. 검증 소유 글·편집본·연결·첨부와 OCI 객체를 정리하고 HEAD `404`·소유 접두사 비었음을 확인. 전용 API·MySQL·볼륨 제거 후 기존 앱·Redis ID/이미지/시작 시각 불변. main `ea3a948`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36231915608)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36231915594) 반영 완료. 공개 API HTTPS와 실사이트 로그인·PRIVATE 이미지 연결은 여전히 없음.

P2-04A는 코드 fence의 언어 표시와 Shiki 구문 강조, 관리자 코드 블록의 언어 편집 작업. 고정된 언어만 코드가 있는 화면에서 지연 로드하고, 알 수 없는 언어·20,000자 또는 500줄을 넘는 코드는 원문으로 표시. 2026-09-26 기존 원문 316개·이미지 18개·코드 45개와 빈 fence 4개, Shiki 36개 자료·웹 검사 7개·타입 검사·API 설정 및 미설정 정적 빌드 통과. 격리 브라우저에서 언어 12종과 별칭·중첩 코드의 색상/원문, 실패 시 원문 유지·수동 재시도, 코드 없는 페이지의 Shiki 미로딩, 언어 편집→저장·재열기·출간, PRIVATE 로그아웃 폐기를 확인. 검사한 읽기·편집 화면의 양 테마 일곱 너비 가로 넘침 0, 네 화면 Axe 위반 0건·미처리 오류 0건. API 미설정 Home·글쓰기·글 상세에서는 설정 안내, API 요청 0건·가짜 코드 0건 확인. 의존성 감사 0건, 검증 소유 API·MySQL·볼륨·브라우저·정적 서버 정리 완료. 기존 앱·Redis ID·이미지·시작 시각 불변. main `94d331d`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36232880765)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36232880774) 반영 완료. P2-04A 당시 인라인 코드·수식·Mermaid와 백엔드·저장소 계약은 그대로였으며 공개 API HTTPS 주소도 미설정. [Markdown 읽기](docs/markdown.md)·[관리자 편집](docs/editor.md) 참고.

P2-04B는 본문·표·안전한 접기의 인라인 `$...$`와 독립 줄 `$$` 수식 읽기, 관리자 수식 블록 편집 작업. 명확한 문법만 변환하고 통화·이스케이프·코드·URL·이미지 설명·미닫힌 수식은 원문으로 보존. KaTeX는 수식이 있을 때만 지연 로드하며 MathML 출력, 외부 서비스·실행 가능한 HTML 차단, 길이/줄 수 상한과 읽기 쉬운 원문 대체를 적용. 2026-09-26 수식 문법 24개·조합 338개와 기존 원문 316개·이미지 18개·코드 45개 자료, 타입 검사·API 설정 정적 빌드 통과. 격리 HTTP/브라우저에서 생성·키보드·접기·저장·재열기·출간, PRIVATE 로그아웃과 첨부 ID 미수집, KaTeX 실패 시 원문/재시도·늦은 로딩 결과 차단 확인. 읽기·편집 양 테마 일곱 너비 가로 넘침 0, 검사한 네 화면 Axe 위반 0건. 수식의 접기 밖 이동·재편입, 위아래 이동, 삭제 취소 시 원문 유지·승인 시 선택 수식만 제거도 확인. API 미설정 정적 빌드와 Home·글쓰기·글 상세 브라우저에서는 설정 안내, API 요청 0건·가짜 수식 0건·페이지 오류 0건. 의존성 감사 취약점 0건, 검증 소유 API·브라우저·정적 서버·MySQL 컨테이너/볼륨 정리 완료. 기존 앱·Redis ID·이미지·시작 시각 불변, OCI는 이 단계에서 미사용. main `d4d291d`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36234501388)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36234501381) 반영 완료. 공개 API HTTPS 연결은 없음. [Markdown 수식 읽기](docs/markdown.md)·[수식 편집](docs/editor.md) 참고.

P2-04C는 정확한 `mermaid` 정보 문자열의 코드 fence를 도식으로 읽고 관리자 원문 블록에서 편집하는 작업. 문단 전체에 백틱 세 개와 `mermaid`를 연달아 입력하고 끝에서 Enter를 누를 때만 전용 블록으로 바꾸며, 불명확한 옵션·공백·대소문자 변형은 원문 유지. 보안 제한과 출력 SVG 검증 뒤 blob 이미지로 표시하고 원문/도식 전환, 실패 시 원문·재시도를 제공. 2026-09-26 기존 원문 316개·이미지 18개·코드 45개·수식 362개 및 Mermaid 10개 자료와 웹 검사 7개·타입 검사·API 설정 정적 빌드 통과. 격리 브라우저에서 도식 5종, 도식 생성·저장·재열기·출간과 PRIVATE 로그아웃, 위험 입력 원문 대체·외부 요청 차단, 로딩 실패 재시도와 늦은 응답 폐기 확인. 읽기·편집 일곱 너비 양 테마 넘침 0, 검사한 네 화면 Axe 위반 0건. API 미설정 정적 빌드와 Home·글쓰기·글 상세 브라우저에서는 설정 안내, API 요청 0건·가짜 도식 0건·페이지 오류 0건 확인. 검증 소유 API·브라우저·정적 서버·MySQL 컨테이너/볼륨 정리 완료. 기존 앱·Redis ID·이미지·시작 시각 불변, OCI 미사용. main `37206ca`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36235981712)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36235981716) 반영 완료. 작성 날짜는 2026-06-29, 실제 push는 2026-09-26 10:30:13 UTC. 공개 HTTPS API 연결은 없음. [Markdown 도식 읽기](docs/markdown.md)·[도식 편집](docs/editor.md) 참고.

P2-05A는 본문의 `[* 내용]`과 `[*이름 내용]`·`[*이름]`을 읽기 화면의 주석 참조·목록으로 표시하는 작업. 이름 없는 주석의 등장 번호는 이름 주석과 별도로 세고, 같은 이름은 문서 전체의 첫 유효한 정의를 공유. 본문·표·안전한 접기에서 같은 정의를 사용하며, 코드·수식·도식·URL·이미지·raw HTML·링크 라벨 안의 표기는 원문으로 보존. 입력·후보·이름·내용 상한과 키보드 이동·말풍선·PRIVATE 로그아웃 정리는 [Markdown 주석 안내](docs/markdown.md) 참고. P2-05A 당시 편집기 블록별 미리보기는 주석 문자를 그대로 표시했고 삽입 버튼과 문서 전체 주석 미리보기는 없었으며, 해당 기능은 P2-05B에서 추가. 2026-09-26 기존 원문 316개·이미지 18개·코드 45개·수식 362개·Mermaid 자료와 접기 위치 9개, 공개 문서의 주석 9개 항목·13개 참조를 확인. 기존 웹 검사 7개·타입 검사·API 설정 정적 빌드·의존성 감사 0건 통과. 격리 브라우저에서 주석 목록 이동·첫 참조 복귀와 접힌 두 단계 조상 열기, 말풍선의 키보드·Escape·스크롤 닫기, PRIVATE 로그아웃 폐기, 편집 원문 저장·재열기와 첨부 ID 미수집을 확인. 읽기·편집 일곱 너비 양 테마 넘침 0, 검사한 네 화면 Axe 위반 0건·페이지 오류 0건. API 미설정 정적 빌드와 브라우저에서는 설정 안내·API 요청 0건·가짜 주석 0건 확인. 검증 소유 API·정적 서버·Chromium·MySQL 컨테이너/볼륨 정리 완료, 기존 앱·Redis ID와 시작 시각 불변, OCI 미사용. main `2614569`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36237102313)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36237102316) 반영 완료. 실제 push는 2026-09-26 10:52:31 UTC. 공개 API HTTPS 연결과 기존 운영 배포는 변경하지 않음.

P2-05B는 관리자 글쓰기에서 주석 삽입과 문서 전체 번호 미리보기를 추가한 작업. 편집 가능한 텍스트 선택 위치에 `[* ]`를 넣고 괄호 앞에 커서를 복원하며, 선택한 글자는 명시적으로 대체. 문단·제목·목록·할 일·인용과 한 단계 접기의 해당 자식만 대상. 코드·수식·도식·원문·이미지·표 셀·접기 제목에는 삽입하지 않음. 문서 전체 미리보기는 저장 본문과 같은 주석 모델을 사용해 익명 번호·이름 정의와 앞선 참조를 한 번만 계산하며 원고와 미저장 상태를 바꾸지 않음. 2026-09-26 기존 웹 검사 7개·타입 검사·API 설정 및 미설정 정적 빌드·의존성 감사 취약점 0건 확인. 격리 브라우저에서 선택 대체·커서 복원, 한 단계 접기 자식, 코드만 있는 글의 새 문단 생성과 코드 원문 보존, CRLF 및 실제 API 저장·재열기·출간 본문 일치와 주석 5개 읽기 번호 일치·첨부 ID 미수집 확인. 읽기·편집 일곱 너비 양 테마 넘침 0, 검사한 네 화면 Axe 위반 0건·페이지 오류 0건. 합성 조합 이벤트만 검증했고 실제 운영체제 IME는 미검증. API 미설정 브라우저에서는 편집 화면·주석이 나타나지 않고 API 요청 0건. 검증 소유 API·정적 서버·Chromium·MySQL 컨테이너/볼륨 정리 완료, 기존 앱·Redis ID·이미지·시작 시각 불변, OCI 미사용. 자세한 범위는 [편집 안내](docs/editor.md)와 [주석 읽기](docs/markdown.md) 참고. main `6dc3988`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36238260848)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36238260817) 반영 완료. 실제 push는 2026-09-26 11:15:34 UTC. 공개 API HTTPS 연결은 없음.

P2-06A는 `[[글 제목]]`이 가리킬 출간 Tech 글을 제목으로 찾는 GET API 작업. 반복 `title` 쿼리로 1~20개 제목을 요청하고 입력 순서대로 읽기 가능·잠금·없음 상태를 받는 계약. PUBLIC은 익명에게 이동용 ID·제목·slug만 제공하고, PRIVATE는 USER/ADMIN 세션에서만 이동 정보를 제공하며 익명에게는 잠금 상태만 반환. 초안·없는 글은 같은 없음 상태. 입력·중복 제목 선택·권한·CORS·캐시 경계는 [위키 제목 조회 API](docs/wiki-links.md) 참고. 2026-09-26 기존 API 검사 28개와 clean verify, 격리 MySQL HTTP의 반복 제목·Unicode·쉼표·대소문자/악센트·중복 정렬, 권한별 응답·출간 철회/이름 변경/삭제 반영, 입력 상한·CORS·no-store·본문 없는 SQL 확인. DB 중단 중 익명·세션 요청의 503과 복구 후 기존 세션 유지 확인. Swagger 보완 후 테스트를 생략한 최종 JAR 패키징과 실제 HTTP/OpenAPI 재검증도 완료. 검증 API·MySQL 컨테이너/볼륨 정리 후 기존 앱·Redis ID·이미지·시작 시각 불변, OCI 미사용. P2-06A 당시 `[[...]]` Markdown 파서·읽기 화면·에디터 링크 UI는 범위 밖이며 읽기 연결은 P2-06B에서 진행. main `d5638dd`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36239305385)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36239305344) 반영 완료. 실제 push는 2026-09-26 11:35:32 UTC. 공개 HTTPS API 연결과 기존 운영 배포는 변경하지 않음.

P2-06B는 본문·주석의 `[[제목]]`·`[[제목|표시명]]` 읽기와 P2-06A 제목 조회 API 연결 작업. 읽을 수 있는 글만 기존 정적 글 경로로 이동하고 잠금·없는·조회 불가 상태를 구분. 2026-09-26 기존 웹 검사 7개·타입 검사·API 설정 정적 빌드와 격리 API/브라우저의 본문·표·접기·주석 링크, 중복 제목 배치, PUBLIC 이동·PRIVATE 잠금·MISSING 비링크, 실패 후 재시도·로그아웃 뒤 메타데이터 제거를 확인. 390/1280px 양 테마 넘침 0, 검사한 두 화면 Axe 위반 0건·페이지 오류 0건. [위키 링크 계약](docs/wiki-links.md) 참고. 검증 자원 정리 후 main `a6f8a6e`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36240322404)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36240322370) 반영 완료. 공개 HTTPS API·기존 운영 배포는 변경하지 않음.

P2-06C는 관리자 제목 검색·링크 선택기, 저장된 제목 연결의 역링크, 본문 목차를 한 흐름으로 잇는 작업. 기존 글의 연결은 자동으로 채워졌다고 가정하지 않으며, 격리 환경에서 실행한 [일회성 재색인 도구](ops/wiki-links/README.md)는 기본 dry-run에서 게시글 연결을 수정하지 않고 `--apply`에서만 본문 해시를 확인한 연결 교체를 요청. 2026-09-26 기존 API 검사 28개와 격리 MySQL의 V9→V10, 검색·보정·권한별 역링크·편집본 분리·본문 없는 SQL을 확인. 22개 기존 글의 보정 대상 14개를 갱신했고 재실행 변경 건수는 0개. 브라우저 통합 검증 완료, main·CI·Pages 반영 확인 전. 공개 Pages의 API HTTPS 주소와 기존 운영 배포는 그대로.

## Spring 컨테이너와 배포 범위

Spring API 이미지는 Buildpacks로 생성. 개발 Compose는 API·MySQL을 실행하며 Web Docker 구성 없음. 포트는 로컬 주소에만 연결. 이 구성은 새 프로젝트의 격리 검증용이며 기존 VM 앱·Redis를 교체한 상태가 아님. 공개 HTTPS API 배포는 아직 수행하지 않음.

Pages의 아키텍처 도면 자산은 유지. 브라우저 첨부 UI는 P2-03B에서 격리 검증했으나 공개 Pages의 API 주소는 계속 미설정. 로그인 화면의 정적 제공과 실사이트 로그인 성공은 별도 상태. 공개 API 배포는 후속 작업.

[도면 설명과 원본](docs/architecture.md)은 정적 프론트 배포, 로컬 MySQL 게시글·계정·세션·첨부 메타데이터와 V7 분류·V8 편집본, 비공개 OCI Object Storage의 관리자 첨부 경로와 격리 검증한 V9 이미지 연결·권한별 전달, 선택적 Redis Cloud 공개 본문 캐시와 후속 공개 HTTPS 연결을 구분.

## 검증 기록

계획별 실제 빌드·테스트·브라우저·CI 결과는 [작업 상태](planning/tasks.md)에서 확인. 메모리 사용량은 [런타임 안내](docs/runtime.md)의 측정 조건과 함께 해석.

실제 환경 파일과 `docs/study/`는 Git 및 Pages 산출물에서 제외. 게시글과 첨부의 연결·권한별 이미지 API는 P2-03A에서 격리 검증했고 브라우저 이미지 입력·표시는 P2-03B에서 격리 검증·main 반영 완료. GA 연동과 공개 HTTPS API 연결은 후속 단계. P1-04B API의 출간·공개 조회는 main 반영 완료이나 운영 API 배포와 Pages의 실제 데이터 연결은 수행하지 않음. P1-04 캐시의 실제 확인 범위는 [계획](planning/issues/P1-04.md)과 [캐시 안내](docs/cache.md) 참고.
