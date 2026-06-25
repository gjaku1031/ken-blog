# 관리자 편집본 저장 — P2-02A

P2-02A는 글쓰기 도중 수동 저장한 내용을 `editor_drafts`에 보관. 기존 게시글의 `DRAFT` 상태는 `posts` 표에 있는 실제 글로서 관리자 게시글 PUT의 대상. 편집본은 새 글 또는 기존 글을 출간하기 전의 **별도 작업 스냅샷**이며, 저장·수정·삭제만으로 원본 `posts` 행이나 이미 공개된 본문·분류·태그·공개 범위를 바꾸지 않는 계약. 2026-09-26 격리 JAR·MySQL에서 기능·경합·롤백 검증 후 main `19b884a`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36224536190)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36224536203) 반영 완료. 브라우저 관리자 편집기·출간 시트도 P2-02B~D에서 구현·검증하고 main 반영 완료. 공개 HTTPS API와 실사이트 관리자 연결은 여전히 없음. P2-03A의 이미지 연결은 격리 검증 완료·main 반영 전. 상세 범위는 [P2-02A 계획](../planning/issues/P2-02A.md) 참고.

| 자원 | 저장 위치와 의미 | 수동 저장의 효과 |
| --- | --- | --- |
| 기존 게시글 `DRAFT` | `posts`의 출간 전 글. 기존 관리자 CRUD·출간 API 대상 | 기존 PUT은 글 원문을 즉시 교체 |
| 관리자 편집본 | Flyway V8의 `editor_drafts`. 새 글 또는 기존 글의 작업 중 내용 | 편집본만 변경. 기존 출간 글의 공개 응답과 서버 내부 본문 캐시는 그대로 유지 |

## 저장 내용과 API

편집본은 ID와 수정 순서 `revision`, 선택적 원본 게시글 ID·원본 기준 `updatedAt`, 제목·slug·Markdown 원문·분류 ID·입력 순서의 태그·`PUBLIC`/`PRIVATE` 범위, 생성·저장 시각을 보관. 같은 기존 글에는 편집본 최대 하나, 원본이 없는 새 글 편집본은 여러 개 허용. 새 편집본의 revision은 `0`에서 시작하고 수동 덮어쓰기마다 하나씩 증가. 상세 JSON은 `{id,revision,postId,baseUpdatedAt,title,slug,body,categoryId,tags,visibility,createdAt,updatedAt}` 형식. 목록 항목은 같은 필드에서 `body`만 제외. 원본 기준 시각은 기존 관리자 글 상세의 UTC `updatedAt` 문자열을 그대로 사용하며, 공개 `publishedDate`와 다른 값.

관리자 기본 경로는 `/api/v1/admin/editor-drafts`. 모든 요청에 유효한 `ADMIN` JDBC 세션 필요. POST·PUT·DELETE와 출간 POST에는 현재 세션의 `X-CSRF-TOKEN` 필요. 성공 응답은 `Cache-Control: no-store`; 공개 origin에는 편집본 조회 CORS를 허용하지 않고 `APP_AUTH_CORS_ALLOWED_ORIGINS`에 명시한 origin에만 자격 증명 GET·POST·PUT·DELETE를 허용. 이 CORS 설정은 ADMIN 권한이나 CSRF 검사를 대신하지 않음.

| 요청 | 입력과 응답 |
| --- | --- |
| `POST /api/v1/admin/editor-drafts` | `postId,baseUpdatedAt,title,slug,body,categoryId,tags,visibility` 모두 필수. 새 글은 앞의 두 값 모두 명시적 `null`, 기존 글은 양수 ID와 관리자 상세의 UTC `updatedAt`. 성공 `201` 상세와 `Location: /api/v1/admin/editor-drafts/{id}` |
| `GET /api/v1/admin/editor-drafts?page=0&size=10` | 선택적 양수 `postId` 필터. 저장 시각·ID 내림차순, 본문 없는 `items,page,size,totalElements,totalPages`의 `200` |
| `GET /api/v1/admin/editor-drafts/{id}` | 본문을 포함한 상세 `200` |
| `PUT /api/v1/admin/editor-drafts/{id}` | 필수 `revision,title,slug,body,categoryId,tags,visibility`로 편집 내용 전체 교체. 원본 ID·기준 시각은 변경하지 않음. 새 상세 `200` |
| `DELETE /api/v1/admin/editor-drafts/{id}?revision=…` | 편집본만 삭제, `204`. 원본 게시글 삭제 없음 |
| `POST /api/v1/admin/editor-drafts/{id}/publish` | 필수 JSON `revision` 확인 후 게시글 출간과 편집본 제거. 최종 관리자 게시글 상세 `200` |

새 글 편집본의 수동 저장 예시. 기존 글 편집본이라면 `postId`와 `baseUpdatedAt`에 관리자 상세의 실제 값을 함께 사용해야 함. 아래 제목·slug·본문은 설명용 값이며 샘플 운영 데이터 아님.

```json
{
  "postId": null,
  "baseUpdatedAt": null,
  "title": "작성 중인 제목",
  "slug": "",
  "body": "# 작성 중\n",
  "categoryId": null,
  "tags": ["kotlin"],
  "visibility": "PRIVATE"
}
```

수동 저장은 빈 제목·slug와 미완성 slug도 허용. 다만 길이와 본문 UTF-8 1 MiB, 태그 개수·길이 및 기존 정규화 규칙, 범위 값 제한은 적용. 분류 ID는 저장 당시 존재 확인 대상이며, V8은 편집본의 분류 ID에 외래 키를 두지 않아 이후 분류 삭제가 저장된 원고를 변경하지 않음. 삭제된 분류로 출간할 때는 `404`와 편집본 보존. 원본 `postId`에는 외래 키와 삭제 연동을 두어 원본 글 삭제 시 연결 편집본도 제거. 출간 시 제목·slug는 기존 게시글의 엄격한 검증을 적용하므로 저장 성공이 출간 가능을 뜻하지 않음. 입력의 필수 여부와 명시적 `null`, 문자열 배열·정수 ID/`revision`의 JSON 타입을 구분.

## P2-03A 편집본 이미지 연결 — 격리 검증 완료

수동 저장 POST·PUT에 선택적 `attachmentIds`를 추가하고 상세 응답에 연결 ID 목록을 반환. 기존 본문 없는 편집본 목록에는 이미지 ID를 추가하지 않음. 새 글 편집본의 생략/`null`은 빈 목록, 기존 글을 바탕으로 만든 새 편집본의 생략/`null`은 **생성 시점 원본 게시글의 연결 상속**, 기존 편집본 PUT의 생략/`null`은 현재 연결 유지. 명시적 `[]`는 해제. 양수 ID 최대 100개를 중복 제거·정렬하고 원소 `null`·0·음수·상한 초과는 `400`, 없는 첨부는 `404`, READY가 아닌 첨부는 `409`로 처리. 저장 실패와 revision 충돌은 연결 변경도 롤백.

편집본 저장은 공개 원본 글의 이미지 연결을 바꾸지 않음. 성공 출간에서는 본문·분류·태그·범위·이미지 연결 반영과 편집본/연결 제거를 한 트랜잭션으로 수행. 출간은 편집본 행 잠금 뒤 현재 이미지 연결을 읽어, 확인한 최신 `revision`의 본문과 같은 저장본에 속한 ID를 반영. 출간 실패 시 글과 편집본의 기존 연결을 모두 유지. 편집본/원본 삭제는 연결 행만 제거하며 OCI 객체는 자동 삭제하지 않음. 실제 화면에서 본문 이미지를 추가·삭제할 때 연결 목록도 명시적으로 갱신하는 기능은 P2-03B 후속 범위. 본문 표기만 바꿔도 서버가 연결을 추론하지 않으며, 구문 제거만으로 기존 연결 권한이 철회되지 않음. [첨부 권한 계약](attachments.md) 참고.

2026-09-26 격리 HTTP에서 기존 공개 글의 편집본 저장 동안 이미지 연결·원문이 그대로 유지되고, 성공 출간에서 편집본 연결이 원본으로 전환되며 편집본은 제거됨을 확인. 저장/출간을 제어된 HTTP·SQL 순서로 겹치게 한 경우 최종 출간의 본문·이미지 ID가 모두 최신 저장본과 일치함을 확인. 오래된 revision·slug 충돌과 부적합 ID의 실패는 기존 원문·두 연결을 유지했고, 연결 중인 이미지의 관리자 삭제는 `409`. V8→V9 전환의 기존 글·JDBC 세션 보존과 별도 새 DB V1~V9 생성도 확인. 실제 운영 API 교체·main 반영은 아직 없음.

## 충돌·출간 경계

`revision`은 편집본 자체의 0 이상 수정 순서. 화면이 읽은 값을 PUT·DELETE·출간 요청에 다시 보내야 하며, 그사이 다른 저장이 성공했다면 오래된 요청은 `409`로 거부. 한 원본에 두 편집본을 동시에 만들려는 요청도 최대 한 건만 성공. 기존 글을 편집할 때는 편집본 생성 시 저장한 `baseUpdatedAt`과 출간 시 원본의 현재 `updatedAt`을 비교. 다른 관리자 게시글 변경이 먼저 커밋되었다면 출간을 `409`로 거부하여 그 변경을 덮지 않음. 단순 편집본 수동 저장은 원본 변경을 반영하지 않으며 출간 성공 전까지 공개 글 원문도 유지.

동시 변경 경계는 분류 공유 잠금→원본 게시글 배타 잠금→편집본 배타 잠금 순서로 구성. [MySQL 8.4의 잠금 읽기](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)는 일반 SELECT 뒤 관련 행을 변경할 때의 경합과 `FOR SHARE`·`FOR UPDATE` 의미를 설명. 편집본 출간이 호출하는 기존 게시글 서비스도 별도 커밋을 만들지 않고 바깥 트랜잭션에 참여하며, [Spring의 `PROPAGATION_REQUIRED` 설명](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)은 이 전파 방식의 동일 물리 트랜잭션을 설명. 같은 원본의 생성·저장·출간 및 저장/출간 혼합 경합을 격리 MySQL에서 확인.

성공 출간은 제목·slug·본문·분류·태그·공개 범위를 한 트랜잭션에서 게시글에 반영하고 해당 편집본을 제거. 기존 글의 최초 `publishedAt` 보존, 새 글의 최초 출간 시각 기록. 게시글 본문 캐시의 무효화는 기존 커밋 후 경계 유지. 제목·slug 형식 오류 `400`, 중복 slug·오래된 `revision`·원본 변경 `409`, 없는 편집본·원본·삭제된 분류 `404`, MySQL 연결 장애 `503` 등 실패에서는 원본과 편집본이 이전 상태로 남는 계약. 편집본 삭제 자체는 원본 글이나 OCI Object Storage 첨부를 정리하지 않음. 원본 게시글을 삭제하면 연결된 편집본도 함께 제거.

## 검증과 배포 경계

2026-09-26 Maven `clean verify`에서 기존 검사 28개 통과. 격리 MySQL의 V7 기존 원문·분류·태그·JDBC 세션이 V8 전환 뒤 보존됨을 확인. 실제 JAR HTTP로 빈/미완성 내용의 수동 저장, revision이 오래된 PUT·DELETE·출간의 `409`, 본문 열을 선택하지 않는 목록 SQL, API 재시작 뒤 편집본 복원 확인. 기존 PUBLIC 글의 편집본 저장·삭제는 공개 원문을 바꾸지 않았고, 성공 출간에서 원문·분류·태그·범위 반영, 편집본 제거, 최초 출간 시각 보존 확인. 중복 slug·원본 변경·삭제된 분류로 인한 출간 실패에서는 원문과 편집본 모두 보존.

같은 원본 편집본의 동시 생성은 `201`/`409`, 동시 저장은 `200`/`409`, 중복 출간은 `200`/`404`; 저장/출간 혼합 경합 4회는 저장 `200`·출간 `409` 또는 저장 `404`·출간 `200`만 발생. 원본 글 삭제의 편집본 연동 제거도 확인. 익명·USER 차단, ADMIN·CSRF, 실제 JSON 타입/상한, Swagger의 세 요청 DTO 필수 필드, 명시 인증 origin의 자격 증명 CORS·공개 전용 origin의 편집본 거부, `no-store`, DB 장애 `503`와 복구 확인. 자체 격리 Redis에서 편집본은 캐시 대상이 아니었고 성공 출간의 커밋 후 이전 공개 본문 키 제거와 `PRIVATE` 전환의 공개 읽기 차단 확인. 검증 DB에만 임시 FK를 추가해 출간 마지막 편집본 삭제를 강제로 실패시킨 경우, 앞선 원문 변경 전체 롤백과 이전 캐시 보존 확인. 새 글 출간에서도 같은 실패를 주입해 고아 `posts` 행 없이 편집본 보존 확인. 이는 실제 운영 장애가 자연 발생한 결과가 아닌 인위적 실패 주입. 새 Buildpacks 이미지나 기존 운영 VM 배포 교체 결과는 없고 main·CI·Pages 반영은 완료.

P2-02B 브라우저 편집 화면은 이 API의 revision·원본 기준 시각 계약을 사용. 2026-09-26 격리 Chrome에서 새 글 수동 저장→URL 변경·새로고침 복원→출간·편집본 제거, 기존 공개 글의 편집본 저장 동안 원문 불변을 확인. 실제 PUT 응답을 지연하고 추가 입력한 경우 화면의 미저장 상태와 다음 revision 저장을 확인했고, 동시 변경 `409`와 CSRF 토큰 제거 `403`에서도 현재 입력을 유지. 기본 블록·미지원 원문·권한 경계 및 남은 검증 상태는 [관리자 편집 화면](editor.md) 참고. 공개 HTTPS API와 운영 배포 연결은 없음.

기존 게시글 DRAFT·출간·권한별 공개 응답은 [게시글 API](posts.md), 세션·CSRF 준비는 [인증 안내](authentication.md), 로컬 실행과 공개 배포 경계는 [런타임 안내](runtime.md) 참고.
