# 관리자 게시글 초안 API

P1-04A의 관리자 API는 MySQL에 저장한 게시글 **초안**의 작성·목록·상세·전체 수정·삭제 제공. 출간 상태와 공개 글 조회, 브라우저 관리자 화면, 게시글과 첨부의 연결은 현재 범위에 없음. 관리자 요청은 격리 로컬 API의 HTTP 도구나 Swagger에서 사용하며, 공개 Pages 화면의 API 주소는 아직 미설정.

## 접근과 요청 준비

기준 경로는 `/api/v1/admin/posts`. 모든 요청에 Spring Session JDBC의 유효한 **ADMIN** 세션 필요. `POST`·`PUT`·`DELETE`에는 같은 세션의 `X-CSRF-TOKEN` 헤더도 필요. 로그인 성공 시 세션 ID와 CSRF 토큰이 바뀌므로 쓰기 전에 [관리자 인증 안내](authentication.md)의 순서대로 `/api/v1/auth/csrf`를 다시 호출. 목록·상세·생성·수정·삭제의 성공 응답에는 `Cache-Control: no-store` 적용. 초안 본문을 공유 캐시에 저장하는 경로 없음.

| 요청 | 성공 응답 | 내용 |
| --- | --- | --- |
| `POST /api/v1/admin/posts` | `201`, `Location: /api/v1/admin/posts/{id}` | JSON `title`·`slug`·`body`로 초안 생성, 상세 DTO 반환 |
| `GET /api/v1/admin/posts?page=0&size=20` | `200` | 기본 page 0·size 20의 요약 목록과 페이지 정보 |
| `GET /api/v1/admin/posts/{id}` | `200` | 양수 ID의 상세 DTO와 본문 원문 |
| `PUT /api/v1/admin/posts/{id}` | `200` | JSON 세 필드를 한 번에 교체한 상세 DTO |
| `DELETE /api/v1/admin/posts/{id}` | `204` | 글 행 삭제, 응답 본문 없음 |

POST와 PUT의 JSON 필드 세 개는 모두 필수이며 OpenAPI에도 required·non-null로 표시. 필드 누락이나 명시적 `null`은 `400`; `body: ""`는 빈 초안 본문으로 허용. PUT은 일부 필드만 바꾸는 PATCH가 아니며, 기존 제목·slug를 유지하려면 그 값도 다시 전송해야 함. `Location`은 공개 글 주소가 아닌 **관리자 상세 조회 상대 경로**.

상세 응답 필드는 `id`, `title`, `slug`, `body`, `createdAt`, `updatedAt`. 목록은 `{ "items": [...], "page": 0, "size": 20, "totalElements": 0, "totalPages": 0 }` 형태이며 각 `items` 항목에는 상세 필드 중 `body`가 없음. JPA 엔티티나 Spring `Page` 내부 형식을 JSON으로 직접 노출하지 않음. 목록 정렬은 `createdAt DESC, id DESC`로 고정. `page`는 0 이상, `size`는 1~100이며 `page × size`가 `Int.MAX_VALUE`를 넘는 과도한 offset도 잘못된 페이지 값으로 `400`. 입력은 유효하지만 데이터 범위 밖인 페이지는 빈 `items`와 `200` 반환. 목록 SQL은 요약 열만 선택하므로 최대 1 MiB 본문을 각 항목마다 읽지 않음.

## 입력과 저장 규칙

제목은 양끝 공백을 제거한 뒤 공백 아닌 1~200 Unicode 코드포인트 필요. slug는 양끝 공백 제거·지역 설정과 무관한 소문자 변환 뒤 소문자 ASCII 영숫자와 **단일 하이픈 구분자**로 된 1~160자 필요. 예: `  My-First-Post  ` → `my-first-post`. 본문은 UTF-8 최대 1 MiB의 **불투명한 원문 문자열**로 저장·반환. HTML 렌더링, Markdown 변환, 에디터 블록 형식의 결정 없음.

생성 시 `createdAt`과 `updatedAt`은 같은 UTC 시각. PUT은 기존 `id`와 `createdAt`을 유지하고 `updatedAt`을 UTC로 갱신. 세 입력을 하나의 트랜잭션에서 검증·변경·flush하며 실패 시 제목·slug·본문 전체 롤백. 자기 자신의 slug를 그대로 쓰는 PUT은 허용; 다른 글의 정규화된 slug와 충돌하면 MySQL `uk_posts_slug` 고유 제약에 따라 `409`. 미리 존재 여부만 확인하는 방식으로 동시 입력의 중복을 판정하지 않음.

수정 버전이나 낙관적 잠금은 이번 범위에 없음. 두 관리자가 같은 초안을 동시에 수정하면 **나중에 커밋된 값이 최종 값이 될 수 있음**. 자동 저장·협업 편집 보장 없음. DELETE는 게시글 행만 제거하며 아직 관계가 없는 OCI Object Storage 객체나 첨부 메타데이터를 함께 삭제하지 않음. 게시글에 이미지를 연결하는 기능과 정리 정책은 후속 계획 대상.

## 오류 경계

게시글 입력·조회 오류는 RFC 9457 `application/problem+json` 응답. 비밀 설정, DB 원문, 요청 본문, 세션 식별자를 공개 오류 설명에 넣지 않음.

| 상태 | 원인 |
| --- | --- |
| `400` | 누락·`null` 필드, 잘못된 JSON·제목·slug·본문 크기·ID·페이지 값 |
| `401` | 유효한 인증 세션 없음 |
| `403` | ADMIN 역할 부족 또는 CSRF 누락·불일치 |
| `404` | 없는 양수 ID의 상세·수정·삭제. 삭제 후 같은 ID 재요청도 포함 |
| `409` | 다른 글과 slug 중복 |
| `503` | MySQL 연결 불가 |
| `500` | 예상하지 못한 내부 오류 |

ID 0·음수는 `400`; 존재하지 않는 **양수** ID는 `404`. Spring Security는 CSRF를 인증보다 먼저 검사할 수 있으므로, CSRF 없는 익명 쓰기 요청은 `401`보다 `403`이 먼저 나올 수 있음. 미인증 응답을 구분하려면 유효한 익명 CSRF를 준비해 요청해야 함. 관리자 API에 대한 브라우저 CORS 허용을 확대하거나 공개 HTTPS 도메인을 연결한 상태는 아님.

저장 구조와 로컬 MySQL 준비는 [게시글 저장 기반](persistence.md), 세션·CSRF 준비는 [관리자 인증 안내](authentication.md), 실행 이미지와 공개 배포 경계는 [런타임 안내](runtime.md) 참고.
