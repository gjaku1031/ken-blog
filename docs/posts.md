# 게시글 API: 관리자 작성·출간과 권한별 조회

P1-04A의 관리자 API는 MySQL 게시글 **초안**의 작성·목록·상세·전체 수정·삭제 제공. P1-04B의 출간/철회·공개 범위와 권한별 읽기 API는 2026-09-26 격리 검증 후 main·CI·Pages 반영 완료. 실제 근거는 [계획](../planning/issues/P1-04B.md)에 기록. P1-04의 익명 PUBLIC 상세 본문 캐시는 선택적 내부 처리로 격리 JAR·Buildpacks/Compose 검증 완료, main·CI·Pages 반영은 예정. 브라우저 공개/관리 화면과 게시글-첨부 연결은 미구현. 관리자 요청은 격리 로컬 API의 HTTP 도구나 Swagger에서 사용하며, 공개 Pages 화면의 API 주소는 아직 미설정.

## 접근과 요청 준비

관리자 기준 경로는 `/api/v1/admin/posts`. 모든 요청에 Spring Session JDBC의 유효한 **ADMIN** 세션 필요. `POST`·`PUT`·`PATCH`·`DELETE`에는 같은 세션의 `X-CSRF-TOKEN` 헤더도 필요. 로그인 성공 시 세션 ID와 CSRF 토큰이 바뀌므로 쓰기 전에 [관리자 인증 안내](authentication.md)의 순서대로 `/api/v1/auth/csrf`를 다시 호출. 관리자 목록·상세·쓰기 성공 응답은 `Cache-Control: no-store`. 초안·비공개 본문을 공유 캐시에 저장하는 경로 없음.

| 요청 | 성공 응답 | 내용 |
| --- | --- | --- |
| `POST /api/v1/admin/posts` | `201`, `Location: /api/v1/admin/posts/{id}` | JSON `title`·`slug`·`body`로 초안 생성, 상세 DTO 반환 |
| `GET /api/v1/admin/posts?page=0&size=20` | `200` | 초안·출간 전체의 요약 목록과 페이지 정보 |
| `GET /api/v1/admin/posts/{id}` | `200` | 양수 ID의 초안·출간 상세 DTO와 본문 원문 |
| `PUT /api/v1/admin/posts/{id}` | `200` | 초안·출간 글의 JSON 세 필드를 한 번에 교체한 상세 DTO |
| `DELETE /api/v1/admin/posts/{id}` | `204` | 글 행 삭제, 응답 본문 없음 |

POST와 PUT의 JSON 필드 세 개는 모두 필수이며 OpenAPI에도 required·non-null로 표시. 필드 누락이나 명시적 `null`은 `400`; `body: ""`는 빈 초안 본문으로 허용. PUT은 일부 필드만 바꾸는 PATCH가 아니며, 기존 제목·slug를 유지하려면 그 값도 다시 전송해야 함. `Location`은 공개 글 주소가 아닌 **관리자 상세 조회 상대 경로**.

상세 응답 필드는 `id`, `title`, `slug`, `body`, `createdAt`, `updatedAt`, `status`, `visibility`, `publishedAt`. `status`는 `DRAFT`/`PUBLISHED`, `visibility`는 `PUBLIC`/`PRIVATE`. 처음 출간 전 `publishedAt`은 `null`. 관리자 목록은 `{ "items": [...], "page": 0, "size": 20, "totalElements": 0, "totalPages": 0 }` 형태이며 각 항목에는 `body`만 없음. JPA 엔티티나 Spring `Page` 내부 형식을 JSON으로 직접 노출하지 않음. 목록 정렬은 `createdAt DESC, id DESC`로 고정. `page`는 0 이상, `size`는 1~100이며 `page × size`가 `Int.MAX_VALUE`를 넘는 과도한 offset도 잘못된 페이지 값으로 `400`. 입력은 유효하지만 데이터 범위 밖인 페이지는 빈 `items`와 `200` 반환. 목록 SQL은 요약 열만 선택하므로 최대 1 MiB 본문을 각 항목마다 읽지 않음.

## 입력과 저장 규칙

제목은 양끝 공백을 제거한 뒤 공백 아닌 1~200 Unicode 코드포인트 필요. slug는 양끝 공백 제거·지역 설정과 무관한 소문자 변환 뒤 소문자 ASCII 영숫자와 **단일 하이픈 구분자**로 된 1~160자 필요. 예: `  My-First-Post  ` → `my-first-post`. 본문은 UTF-8 최대 1 MiB의 **불투명한 원문 문자열**로 저장·반환. HTML 렌더링, Markdown 변환, 에디터 블록 형식의 결정 없음.

생성 시 `createdAt`과 `updatedAt`은 같은 UTC 시각. PUT은 기존 `id`와 `createdAt`을 유지하고 `updatedAt`을 UTC로 갱신. 세 입력을 하나의 트랜잭션에서 검증·변경·flush하며 실패 시 제목·slug·본문 전체 롤백. 자기 자신의 slug를 그대로 쓰는 PUT은 허용; 다른 글의 정규화된 slug와 충돌하면 MySQL `uk_posts_slug` 고유 제약에 따라 `409`. 미리 존재 여부만 확인하는 방식으로 동시 입력의 중복을 판정하지 않음.

수정 버전이나 낙관적 잠금은 이번 범위에 없음. 두 관리자가 같은 글을 동시에 수정하면 **나중에 커밋된 본문 값이 최종 값이 될 수 있음**. P1-04B의 출간/철회/공개 범위 변경과 PUT은 같은 행에 쓰기 잠금을 걸어 오래 읽은 상태 필드로 다른 변경을 덮지 않도록 구성. 자동 저장·협업 편집 보장 없음. DELETE는 게시글 행만 제거하며 아직 관계가 없는 OCI Object Storage 객체나 첨부 메타데이터를 함께 삭제하지 않음. 게시글에 이미지를 연결하는 기능과 정리 정책은 후속 계획 대상.

## 출간·공개 범위 계약 — P1-04B 격리 검증 완료

Flyway V5는 기존 글을 모두 `DRAFT`·`PRIVATE`·출간 시각 없음으로 옮겨 자동 공개를 막는 계약. 관리자에게만 다음 쓰기 경로 허용; 모두 `200` 상세 DTO와 `Cache-Control: no-store`, 유효한 세션·CSRF 필요.

| 요청 | 입력과 효과 |
| --- | --- |
| `POST /api/v1/admin/posts/{id}/publish` | 필수 JSON `{"visibility":"PUBLIC"}` 또는 `PRIVATE`; 출간·재출간 |
| `POST /api/v1/admin/posts/{id}/unpublish` | 본문 없이 출간 철회, 상태 `DRAFT` |
| `PATCH /api/v1/admin/posts/{id}/visibility` | 필수 JSON `visibility`; 상태는 그대로 두고 범위만 변경 |

최초 출간에서 `publishedAt`을 UTC로 기록. 철회·같은 상태 반복·재출간·범위 변경·본문 PUT은 최초 시각 보존. 초안 상태에서 visibility를 `PUBLIC`으로 바꾸더라도 공개 조회에는 나오지 않음. `publishedAt`을 삭제하거나 최근 수정 시각으로 다시 대체하지 않음. `visibility` 누락·`null`·지원하지 않는 값은 `400`, 없는 양수 ID는 `404`.

공개 기준 경로 `/api/v1/posts`는 출간된 글만 제공. 아직 공개 Pages와 연결되지 않았으며 아래는 직접 HTTP/API 계약.

| 요청 | 접근과 응답 |
| --- | --- |
| `GET /api/v1/posts?page=0&size=10` | 익명은 `PUBLISHED`·`PUBLIC`만, 로그인 `USER`/`ADMIN`은 `PUBLISHED` 전체. `items`, `page`, `size`, `totalElements`, `totalPages` 반환 |
| `GET /api/v1/posts/{slug}` | 공개 글 또는 로그인 `USER`/`ADMIN`의 비공개 글은 본문 포함. 익명의 `PRIVATE` 직접 주소는 잠금 상세. 없는 글·초안은 `404` |

공개 목록 항목은 `id`, `title`, `slug`, `publishedDate`만 포함. `publishedDate`는 최초 UTC `publishedAt`을 `Asia/Seoul` 날짜로 변환한 `YYYY-MM-DD`; 관리자 `publishedAt` 원시 UTC 시각과 구분. 목록은 본문 열을 선택하지 않고 `publishedAt DESC, id DESC` 고정 정렬. SQL 목록과 전체 건수에 같은 상태·권한 조건을 적용. 기본 `page=0`, `size=10`; page 0 이상, size 1~100, `page × size ≤ Int.MAX_VALUE`. 데이터 범위를 넘는 유효 페이지는 `200`·빈 `items`, 잘못된 페이지는 `400`.

공개 상세는 `id`, `title`, `slug`, `publishedDate`, `locked`, `body`. 익명의 비공개 slug 직접 요청에만 `locked=true`, `body=null`과 최소 제목·출간일을 제공. 이 제목 노출은 잠금 화면용으로 제한하며 목록·검색·건수에는 비공개 글을 포함하지 않음. 잠금 조회는 DB에서도 본문 열을 선택하지 않음. 공개/로그인 허용 상세는 `locked=false`와 원문 본문. 요약·관련 글·첨부 정보는 이 단계의 공개 DTO에 없음. 익명 판정에서 Spring의 익명 토큰 `isAuthenticated` 값을 신뢰하지 않고 `ROLE_USER`/`ROLE_ADMIN`만 비공개 열람 권한으로 취급.

공개 GET은 계속 `Cache-Control: no-store`; CDN·브라우저 공유 캐시 사용 없음. P1-04의 Redis Cloud는 아래와 같은 선택적 **서버 내부 본문 캐시**로 HTTP 캐시와 구분. `APP_CORS_ALLOWED_ORIGINS`의 정확한 공개 origin에는 GET 응답 접근을 허용하되 자격 증명 CORS 응답은 허용하지 않음. 이 설정만으로 서버가 전달된 쿠키를 무시하는 것은 아님. 로그인 쿠키가 필요한 교차 출처 GET은 별도 `APP_AUTH_CORS_ALLOWED_ORIGINS`에 명시된 origin에 한해 자격 증명 응답 접근 허용. 공개 HTTPS 주소·타사 쿠키/동일 사이트 배치 검증 전에는 브라우저 로그인 연결 완료로 보지 않음. 분류·태그·검색·프로젝트·과목·리비전 초안·게시글/첨부 연결은 후속 범위.

## 선택적 본문 캐시 — P1-04 격리 검증 완료

익명 `GET /api/v1/posts/{slug}`가 `PUBLISHED`·`PUBLIC`일 때만 MySQL에서 먼저 권한·제목·slug·출간 시각·현재 본문 SHA-256을 확인. 본문 열을 제외한 메타데이터 판정 뒤 Redis Cloud의 전용 키 `{prefix}:v1:post-body:{id}:{bodySha256}`에 일치하는 본문이 있으면 사용. 캐시 값의 UTF-8 크기와 SHA-256을 검증하고, 손상·miss·Redis 오류는 MySQL 원문으로 복귀. 정상 본문이 256 KiB 이하면 빈 문자열도 TTL 300초로 저장. 256 KiB 초과~기존 1 MiB 이하 본문은 정상 제공하되 캐시 생략. SHA-256은 캐시 값의 원본 일치 확인이지 전송 암호화가 아님.

본문 수정은 해시를 바꾸며, 출간 철회·PRIVATE 전환·삭제 때에도 MySQL 권한 판정을 생략하지 않음. 이전 키 삭제는 커밋 후 최선의 노력이며 잔여 키는 재사용 방지·TTL 정리. 로그인 상세·익명 잠금·목록·초안·관리자 요청·세션·첨부는 캐시하지 않음. DB 장애는 캐시 hit가 있더라도 기존 503 경계 유지. 기본값은 캐시 비활성, 외부 Redis 없이 기존 조회 유지. 설정·장애·검증 범위는 [공개 본문 캐시 안내](cache.md) 참고.

## 오류 경계

게시글 입력·조회 오류는 RFC 9457 `application/problem+json` 응답. 비밀 설정, DB 원문, 요청 본문, 세션 식별자를 공개 오류 설명에 넣지 않음.

| 상태 | 원인 |
| --- | --- |
| `400` | 누락·`null` 필드, 잘못된 JSON·제목·slug·본문 크기·ID·페이지 값 |
| `401` | 유효한 인증 세션 없음 |
| `403` | ADMIN 역할 부족 또는 CSRF 누락·불일치 |
| `404` | 없는 양수 ID의 관리자 상세·수정·삭제/상태 변경, 없는 또는 초안인 공개 slug. 삭제 후 같은 ID 재요청도 포함 |
| `409` | 다른 글과 slug 중복 |
| `503` | MySQL 연결 불가 |
| `500` | 예상하지 못한 내부 오류 |

ID 0·음수는 `400`; 존재하지 않는 **양수** ID는 `404`. Spring Security는 CSRF를 인증보다 먼저 검사할 수 있으므로, CSRF 없는 익명 쓰기 요청은 `401`보다 `403`이 먼저 나올 수 있음. 미인증 응답을 구분하려면 유효한 익명 CSRF를 준비해 요청해야 함. 관리자 API에 대한 브라우저 CORS 허용을 확대하거나 공개 HTTPS 도메인을 연결한 상태는 아님.

저장 구조와 로컬 MySQL 준비는 [게시글 저장 기반](persistence.md), 세션·CSRF 준비는 [관리자 인증 안내](authentication.md), 실행 이미지와 공개 배포 경계는 [런타임 안내](runtime.md) 참고.

## 실제 검증 범위

2026-09-26 P1-04B 격리 JAR·Buildpacks/Compose HTTP에서 기존 V4 초안의 V5 전환 후 비노출, PUBLIC/PRIVATE 권한별 목록·건수, KST 출간일, 익명 PRIVATE 직접 조회의 `body=null`, 실제 목록 SQL의 본문 열 제외 확인. 출간·철회·재출간·반복 요청에서 최초 출간 시각 유지, 동시 PUT·공개 범위 변경의 상태 보존, ADMIN/CSRF·CORS·잘못된 `visibility` 타입(숫자·불리언·배열·`null`) 거부, API 재시작 후 JDBC 세션, DB 중단의 약 30초 후 503과 복구, 로그아웃 확인. 기존 28개 검사 통과는 최종 enum 입력 DTO 정정 **전** 결과이며, 정정 뒤에는 이미지를 다시 빌드해 JAR/Compose HTTP와 Swagger의 필수 문자열 enum을 확인. 검증 자원 정리, 기존 VM 앱·Redis 유지. P1-04B main·CI·Pages 성공 확인. P1-04 캐시나 공개 HTTPS 브라우저 연결의 완료 근거로 확장하지 않음.
