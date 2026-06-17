# Tech 분류·태그와 권한별 탐색

P1-05A는 게시글에 최대 3단계 Tech 분류와 순서 있는 태그를 연결하고, 같은 권한 기준으로 분류 수·태그 수·글 목록을 조회하는 단계. 2026-09-26 최종 소스의 기존 검사 28개와 격리 JAR HTTP·SQL·공개 본문 캐시 활성 호환 검증 통과. 검증 자원 정리 후 main `e147f10`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36221577967)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36221578032) 반영 완료. 기존 글은 분류가 없는 상태로 유지하며 샘플 분류·태그를 자동 생성하지 않음. 브라우저 분류 화면과 공개 HTTPS API 연결은 별도 범위.

| 경로 | 접근·성공 응답 |
| --- | --- |
| `POST /api/v1/admin/categories` | ADMIN·CSRF, `201` 분류 참조 |
| `GET /api/v1/admin/categories` | ADMIN, `200` 초안 포함 전체 트리 배열 |
| `DELETE /api/v1/admin/categories/{id}` | ADMIN·CSRF, `204` 본문 없음 |
| `PATCH /api/v1/admin/posts/{id}/taxonomy` | ADMIN·CSRF, `200` 게시글 상세 |
| `GET /api/v1/categories` | 익명/회원, `200` 권한별 트리 배열 |
| `GET /api/v1/tags` | 익명/회원, `200` 권한별 태그 배열 |
| `GET /api/v1/admin/tags` | ADMIN, `200` 초안 포함 태그 배열 |

## 분류 경로와 트리

분류는 MySQL의 독립 행으로 보존. 각 행은 ID, 부모 ID, 표시 이름, 정규화된 전체 `path`, 깊이 1~3을 갖고 게시글은 nullable `category_id` 외래 키로 연결. 빈 분류도 행으로 남아 트리에 표시 가능. 관리자 `POST /api/v1/admin/categories`는 JSON `path` 한 개로 경로를 생성하고 `201`에 `{id,path,name,depth}` 참조를 반환하는 계약. `Location` 헤더는 없음. `/`로 나눈 각 단계의 양끝 공백을 제거하고 지역 설정과 무관하게 소문자화하며 연속 **ASCII 공백**은 표시 이름에서는 한 칸, 정규화 경로에서는 단일 하이픈으로 바꿈. 예를 들어 다음 요청은 `tech`, `tech/spring-boot`, `tech/spring-boot/security`를 생성하거나 기존 중간 경로를 재사용하는 계약.

```json
{"path":"Tech / Spring   Boot / Security"}
```

최종 경로가 이미 있으면 `409`; 중간 경로만 기존에 있으면 재사용. 단계별 표시 이름은 1~60 Unicode 문자이며 한글 등 문자·숫자와 내부 단일 ASCII 공백·하이픈을 허용. 빈 단계, 네 단계 이상, 제어 문자, 허용하지 않은 기호는 `400`. 중간 행 생성과 최종 생성은 한 트랜잭션이므로 마지막 단계가 실패하면 그 요청이 만든 중간 행도 롤백. 분류 이름 변경·부모 이동 API는 이번 범위에 없음.

관리자 `GET /api/v1/admin/categories`는 초안과 출간 글을 모두 센 전체 트리, 공개 `GET /api/v1/categories`는 현재 요청자가 **읽을 수 있는 출간 글**을 센 트리. 둘 다 루트 노드의 배열을 반환하며 노드 형식은 `{id,path,name,depth,directCount,totalCount,children:[...]}`. 각 노드의 `directCount`는 그 분류에 직접 연결된 글 수, `totalCount`는 자기 노드와 모든 하위 분류의 글 수. 익명은 `PUBLISHED`·`PUBLIC`만, 유효한 `USER`/`ADMIN` 역할은 `PUBLISHED`·`PUBLIC`/`PRIVATE`를 포함. 공개 트리에는 빈 폴더와 0건 표시 가능. 폴더 이름·경로 자체는 공개 탐색 메타데이터로 취급하지만 비공개/초안 글의 제목·태그·존재 수를 공개 건수에 섞지 않음.

관리자 `DELETE /api/v1/admin/categories/{id}`는 성공 시 `204`이며 해당 분류와 모든 하위 분류를 삭제하되 **글은 삭제하지 않음**. 삭제 대상 어디에 연결된 글이든 삭제 대상의 부모 분류로 한 번에 옮김. 최상위 분류 삭제라면 `categoryId`를 `null`로 해제. 예를 들어 `tech` 아래 `tech/backend`와 `tech/backend/spring`이 있을 때 `backend`를 삭제하면 두 하위 위치의 글 모두 `tech`로 이동하고 본문·상태·최초 출간일은 유지. 글 이동과 하위부터의 분류 삭제는 원자적이며, 동시 참조·경로 생성 경합으로 충돌하면 `409` 또는 이미 없어진 ID의 `404`로 처리. 부분 이동이나 고아 외래 키를 성공 결과로 남기지 않음.

## 글의 분류·태그 변경

관리자 `PATCH /api/v1/admin/posts/{id}/taxonomy`는 분류와 태그 전체를 한 요청에서 교체하고 성공 시 `200` 관리자 글 상세를 반환. 유효한 ADMIN 세션과 현재 세션의 `X-CSRF-TOKEN` 필요. `categoryId`는 **필수** 정수 분류 ID 또는 분류 해제를 뜻하는 명시적 `null`; `tags`는 필수 문자열 배열이며 빈 배열 `[]`은 모든 태그 제거. 예시는 형식 안내이며 실제 ID나 계정 정보가 아님.

```json
{"categoryId":42,"tags":[" Kotlin ","kotlin","MySQL"]}
```

태그는 양끝 공백 제거·`Locale.ROOT` 소문자화 뒤 정규화 중복 제거. 위 입력의 저장 순서는 `kotlin`, `mysql`. 태그는 한 글에 최대 16개, 각 1~40 Unicode 문자. 빈 값·제어 문자·배열 누락/`null`, 문자열 숫자·소수·불리언 등 잘못된 `categoryId` JSON 타입, 문자열이 아닌 태그 원소는 `400`. 존재하지 않는 양수 `categoryId`나 없는 글은 `404`, 잘못된 ID·입력 형식은 `400`, 동시 외래 키/고유 제약 충돌은 `409`. 게시글 행 잠금과 트랜잭션을 유지하여 분류·태그가 함께 변경되거나 함께 롤백. 기존 POST·PUT의 `title`·`slug`·`body` 입력 계약은 유지하고 taxonomy 변경은 본문 SHA-256·최초 출간 시각을 바꾸지 않음. 글 삭제 때 연결된 태그 행도 정리.

관리자 상세와 본문 없는 관리자 목록에는 현재 `category:{id,path,name,depth}|null`과 순서 있는 `tags:string[]` 추가. 공개 목록과 읽기가 허용된 공개 상세에도 같은 두 필드 제공. 익명의 `PRIVATE` 직접 주소 잠금 응답은 기존 제목·출간일만 유지하고 `category=null`, `tags=[]`, `body=null`로 숨김. 본문 캐시에는 분류·태그를 넣지 않고 매 요청 MySQL의 현재 메타데이터 사용.

## 공개 필터와 태그 집계

`GET /api/v1/posts`에는 선택적 `categoryId`와 `tag`를 추가. 분류 필터는 지정 노드와 모든 하위 노드, 태그 필터는 정규화한 이름의 정확한 일치이며 둘 다 주어지면 AND. 예: `/api/v1/posts?categoryId=42&tag=kotlin&page=0&size=10`. 존재하지 않는 양수 분류 ID는 `200`과 빈 목록·0건; 잘못된 ID·태그·페이지 입력은 `400`. 기존 `publishedAt DESC, id DESC` 정렬과 페이지 계약 유지. SELECT와 COUNT에 같은 출간·권한·분류·태그 조건을 적용하고 목록 SQL에서 본문 열을 읽지 않음.

공개 `GET /api/v1/tags`는 현재 요청자가 읽을 수 있는 `PUBLISHED` 글에서 태그 이름과 해당 태그를 사용한 글 수의 `{name,count}` 배열을 제공. 관리자 `GET /api/v1/admin/tags`는 초안을 포함한 모든 글에서 자동완성용 같은 형식의 배열 제공. 사용량 내림차순, 이름 오름차순 정렬. 익명에게는 미사용 태그, 비공개 글 전용 태그, 초안 전용 태그의 이름·개수를 제공하지 않음. 태그 자체의 생성·수정·삭제 CRUD는 없으며 게시글 taxonomy 변경으로 관리.

새 공개 GET은 익명 접근과 기존 공개 origin의 credential 없는 CORS 범위에 포함. 유효한 로그인 세션의 비공개 글 열람은 기존 인증 origin·권한 규칙 적용. 관리자 경로는 ADMIN 및 변경 요청 CSRF 유지. 공개·관리자 성공 응답은 계속 `Cache-Control: no-store`; 오류는 기존 `application/problem+json` 계약. 계정·JDBC 세션, Redis Cloud의 공개 **본문 전용** 캐시, OCI Object Storage 설정은 변경하지 않음.

## 검증 경계

2026-09-26 기존 검사 28개 통과. 격리 MySQL·JAR API HTTP에서 기존 V6 Unicode 글의 V7 전환·기존 내용 보존과 새 DB V7 기동, 엄격한 JSON 타입·한글 경로·깊이·중복·ADMIN/USER/익명·CSRF·Swagger 필수/nullable `int64`와 `array<string>` 계약 확인. 중간 노드 재사용·실패 롤백, 빈 폴더·권한별 직접/하위 수, 태그 정규화·중복 제거·순서·빈 배열, 익명 PRIVATE 잠금의 `category=null`·`tags=[]`, 분류·태그 AND 필터와 페이지 SELECT/COUNT 일치 확인. 중분류·대분류 삭제 시 자손 글·초안을 부모/`null`로 이동하면서 본문·최초 출간일 보존, 게시글 삭제 시 태그 제거, 병렬 경로 생성·삭제/할당 경합의 오류 응답과 API 재시작 뒤 JDBC 세션 유지 확인. 공개 2건 페이지의 실제 SQL은 분류 필터 조회, 본문 제외 게시글 조회, 분류 일괄 조회, `post_tags` 한 번 조회로 확인. CORS·`no-store`도 확인.

기존 Redis Cloud 공개 본문 캐시를 활성화한 격리 HTTP에서는 hit 상태의 taxonomy PATCH 뒤 현재 분류·태그가 즉시 반영되고, 분류 삭제 뒤 `category=null`·태그 보존 확인. 캐시 hit에도 본문 SQL은 제외되고, PRIVATE 전환 뒤 이전 키 제거와 본문·분류·태그 잠금, 최초 출간일 보존 확인. 소유 JAR·MySQL·Redis·볼륨은 제거했으며 기존 배포의 ID·이미지·시작 시각은 유지. 이번 P1-05A에서 새 Buildpacks 이미지를 빌드한 결과는 없음. 소스 작성 시각인 2026-06-14~15와 실제 검증·main 반영일인 2026-09-26은 구분. 공개 Pages의 Tech 탐색 UI·검색·Projects/Notes·편집기 화면은 이 API 단계의 완료 조건에 포함하지 않음.
