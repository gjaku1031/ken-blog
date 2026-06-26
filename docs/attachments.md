# 관리자 이미지 첨부 운영 안내

P1-03의 첨부 기능은 관리자 전용 이미지 원본을 **OCI Object Storage의 기존 비공개 버킷**에 저장하고, 첨부 ID·object key·파일 정보·업로드 계정·처리 상태를 새 프로젝트의 MySQL `attachments` 테이블에 기록. P2-03A에서는 글·편집본과 이미지의 명시적 연결 및 Spring 경유 권한별 읽기를 추가해 2026-09-26 실제 OCI·격리 HTTP 검증을 통과. DB 장애·복구와 새 DB 검증·소유 자원 정리도 통과했으며 main `5fd3e32`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36230515666)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36230515657) 반영 완료. 이미지 업로드·본문 표시는 P2-03B의 격리 검증을 완료한 정적 화면 범위이며 main 반영 전. 기존 VM 앱·Redis와 공개 Pages 배포는 이 기능으로 교체되지 않음.

## 외부 설정과 실행 경계

Spring API에 다음 값을 실행 환경에서 주입. 버킷 이름·endpoint·access key·secret key의 실제 값은 저장소·문서·명령 기록·로그에 남기지 않음. API는 OCI Object Storage의 **S3 호환 HTTPS endpoint**에 서버에서 접근하며, 브라우저에는 저장소 키나 직접 업로드 URL을 전달하지 않음.

| 환경변수 | 용도 |
| --- | --- |
| `OCI_OBJECT_STORAGE_ENDPOINT` | OCI Object Storage S3 호환 HTTPS endpoint |
| `OCI_OBJECT_STORAGE_REGION` | endpoint의 리전 |
| `OCI_OBJECT_STORAGE_BUCKET` | 기존 비공개 버킷 |
| `OCI_OBJECT_STORAGE_ACCESS_KEY` | 외부에서 주입하는 Customer Secret Key의 access key |
| `OCI_OBJECT_STORAGE_SECRET_KEY` | 외부에서 주입하는 Customer Secret Key의 secret key |
| `OCI_OBJECT_STORAGE_KEY_PREFIX` | 이 기능의 object key 접두사. 기본값 `ken-blog/attachments` |

필수 다섯 값이 모두 비어 있으면 앱의 상태·로그인·게시글 기능은 기동하되 첨부 API는 `503`을 반환. 일부만 설정하면 기동 시 설정 오류. 스토리지 연결은 선택 사항이지만, 실제 첨부 검증에는 다섯 값 모두 필요. `OCI_OBJECT_STORAGE_KEY_PREFIX`는 운영 객체와 검증 객체가 섞이지 않도록 실행별 하위 접두사를 붙여 지정. 버킷 전체를 검증용으로 사용하거나 기존 버킷 정책·공개 여부를 바꾸지 않음. Compose의 API·MySQL 로컬 포트와 이미지 재빌드 방법은 [런타임 안내](runtime.md) 참고.

## 관리자 HTTP 계약

모든 경로는 `/api/v1/admin/attachments` 아래에 위치. Spring Session JDBC의 로그인 세션과 `ADMIN` 역할 필요. `POST`·`DELETE`에는 기존 CSRF 토큰 검증도 적용. 로그인·CSRF 준비는 [관리자 인증 안내](authentication.md) 참고.

| 요청 | 결과 |
| --- | --- |
| `POST /api/v1/admin/attachments` | multipart `file` 한 개를 검증·저장하고 READY 메타데이터 반환. 전체 저장 완료 시 `201` |
| `GET /api/v1/admin/attachments/{id}` | 지정 ID의 메타데이터와 처리 상태 조회 |
| `GET /api/v1/admin/attachments/{id}/content` | READY 이미지 원본을 Spring을 거쳐 스트리밍 다운로드 |
| `DELETE /api/v1/admin/attachments/{id}` | 지정 첨부의 객체와 메타데이터 삭제. 정상 완료 시 `204`, 이후 조회는 `404`. P2-03A에서는 글·편집본에 연결된 첨부의 삭제를 `409`로 거부 |

메타데이터 JSON 필드는 `id`, `originalFilename`, `contentType`, `byteSize`, `uploadedBy`(계정명), `status`, `createdAt`, `updatedAt`. 내부 `objectKey`는 응답에 포함하지 않음. 활성 PENDING의 DELETE는 `409`. **2분 이상 지난 PENDING**에 대한 첫 DELETE는 객체 삭제를 시도하고 DELETING 행을 남긴 뒤 `409`를 반환. 지연 PUT에 대비해 2분 더 기다린 후 같은 ID로 DELETE를 재시도해 `204`로 마침.

JPEG·PNG만 허용하며 파일당 최대 **10 MiB**, 한 변 최대 **8,192픽셀**, 총 최대 **2,000만 픽셀**. 이미지 시그니처·디코딩 결과로 실제 형식을 확인하고, 파일 확장자와 선언된 Content-Type이 그 형식과 맞아야 함. 표시용 원본 파일명은 180 코드포인트 이하로 제한하고 제어문자·경로 구분자를 거부. 저장 object key는 서버가 접두사와 UUID·판별한 확장자로 만듦. 클라이언트 파일명·경로·URL을 object key로 사용하지 않음. 다운로드 응답에는 서버가 판별한 MIME, 안전한 파일명과 `nosniff`가 적용되며 관리 파일은 공유 캐시 대상이 아님. 공개 버킷 URL·presigned URL·직접 브라우저 업로드·이미지 리사이즈는 제공하지 않음.

응답 확정 전 오류는 RFC 9457 `ProblemDetail`로 반환. 잘못된 입력 `400`, 미인증 `401`, 권한·CSRF `403`, 없는 ID `404`, 다운로드할 수 없는 처리 상태 `409`, 크기 초과 `413`, 지원하지 않거나 손상된 형식 `415`, 저장소 미설정·OCI 장애·DB 연결 불가 `503`으로 구분. 예기치 않은 DB 제약 위반 등 다른 미처리 오류는 안전한 `500`이 될 수 있음. 공급자 오류 원문·비밀값·내부 object key를 오류 응답에 노출하지 않음. 다운로드는 OCI 입력 스트림을 **HTTP 헤더 전** 열므로 이 단계의 저장소 오류는 `503`. 헤더를 보낸 뒤 전송 중 네트워크 장애가 나면 연결이 중단되거나 본문이 불완전할 수 있으며, 이미 확정된 응답을 `ProblemDetail`로 바꿀 수 없음. 호출자는 다운로드 바이트 수와 이미지 내용을 확인해야 함.

## P2-03A 이미지 연결·권한별 읽기 계약 — 격리 검증 완료

Flyway V9는 `post_attachments`·`editor_draft_attachments` 관계를 관리. 관리자 게시글·편집본 저장 요청의 선택적 `attachmentIds`는 **읽기를 허용하는 명시적 연결 목록**. 양수 ID 최대 100개를 중복 제거·정렬해 저장하고, 원소 `null`·0·음수·상한 초과는 `400`, 없는 첨부는 `404`, READY가 아닌 첨부는 `409`로 처리. 새 글의 생략/`null`은 빈 목록, 기존 글을 바탕으로 한 새 편집본의 생략/`null`은 원본 연결 상속, 기존 글·편집본 수정의 생략/`null`은 연결 보존, 명시적 `[]`는 전체 연결 해제. 원문만 수정하거나 이미지 구문을 지워도 남아 있는 연결은 계속 권한이 되므로 연결 철회에는 `attachmentIds`의 명시적 변경 필요. 반대로 본문·코드 예제에 ID 문자열만 써도 권한이 생기지 않음. 실패한 글/편집본 저장·출간은 연결 변경도 같은 DB 트랜잭션에서 롤백. 편집본 출간은 잠근 편집본의 최신 `revision`을 확인한 뒤 현재 연결 행을 읽어 본문과 ID가 서로 다른 저장본에서 섞이지 않도록 처리.

`GET /api/v1/posts/{postId}/attachments/{id}/content`는 **slug가 아닌 게시글 ID**를 사용. 요청마다 MySQL에서 글의 `PUBLISHED` 상태·`PUBLIC` 또는 로그인 USER/ADMIN 열람권·해당 글 연결·첨부 READY를 확인한 뒤에만 Spring이 비공개 OCI 원본을 읽음. 초안·없는 글/첨부·미연결·권한 없는 읽기는 모두 `404`; 관리자 미리보기는 기존 관리자 content 경로 유지. 이미지 응답은 `private, no-store`, `inline`, 판별 MIME·길이·`nosniff`를 적용하고 업로드 계정·object key·원본 파일명은 노출하지 않음. OCI 스트림 열기 실패는 HTTP 헤더 확정 전 `503 ProblemDetail`로 처리하되, 전송 시작 뒤 권한 변경을 소급 취소하거나 이미 보낸 헤더를 오류 응답으로 교체하지는 못함. 이미지 권한은 Redis 본문 캐시나 Markdown 문자열로 판단하지 않음.

참조 중인 첨부 DELETE는 `409`로 거부하고, READY 확인·참조 검사·DELETING 전환과 연결 변경 사이를 첨부 행 잠금으로 보호. 글·편집본 삭제는 관계 행만 제거하고 OCI 객체는 남김. 자동 고아 객체 정리 없음. 운영자는 해당 글/편집본의 연결을 명시적으로 해제한 뒤 기존 관리자 DELETE로 정확한 첨부 ID만 정리. 후속 화면의 canonical 본문 표기는 `attachment:<양수 ID>`이며 OCI endpoint·버킷·object key·서명 URL을 본문에 저장하지 않음. 브라우저 입력·표시는 P2-03B 구현·검증 중.

공개 API HTTPS 주소 미설정 상태. 로컬의 같은 `127.0.0.1` 호스트·다른 포트에서 `SameSite=Lax` 쿠키를 시험하는 일은 교차 site Pages에서 PRIVATE 이미지나 관리자 첨부를 읽는다는 근거가 아님. 관리자 첨부 CORS는 명시된 인증 origin의 GET/POST/DELETE에만 자격 증명과 필요한 CSRF 헤더를 허용하며 공개 전용 origin에는 관리자 접근 없음.

2026-09-26 격리 Maven 기존 API 검사 28개·웹 검사 7개/타입 검사/정적 빌드 통과. 기존 V8 DB에서 V9로 옮겨 원문과 JDBC 세션을 보존했고, 별도 새 DB에서도 V1~V9·관리자 준비·로그인·글 생성을 실제 HTTP로 확인. 실제 OCI PNG/JPEG의 HTTP 바이트 일치, PUBLIC 익명·PRIVATE USER/ADMIN 읽기, 미연결·미허용 `404`, 엄격한 ID 입력과 일괄 롤백, 편집본 저장 동안 원본 연결 불변·출간 시 연결 전환을 확인. 저장/출간의 제어된 HTTP·SQL 경합에서는 출간된 본문과 연결 ID가 같은 최신 revision에 일치. 사용 중 삭제 `409`, 삭제 잠금 대기 후 DELETING 재확인 `409`, 동시 연결/삭제의 일관성, 저장소 객체 부재 `503`과 복구, CORS·CSRF를 확인. 격리 MySQL 중단 중 익명·인증 이미지 모두 `503 ProblemDetail`, 복구 후 같은 JDBC 세션과 이미지 읽기 복원도 확인. 기존 운영 앱·Redis/버킷 정책과 공개 Pages API 연결을 변경한 결과는 아니며, 검증 소유 글·편집본의 연결 해제/삭제 뒤 첨부 DELETE `204`, 각 OCI HEAD `404`, 정확한 소유 접두사 목록 0·메타데이터 0을 확인하고 소유 JAR·MySQL 컨테이너·볼륨을 제거. 기존 VM 앱·Redis ID·이미지·시작 시각은 동일. main `5fd3e32`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36230515666)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36230515657) 반영 완료.

## P2-03B 브라우저 사용 경계 — 격리 브라우저 검증·자원 정리 완료

관리자 글쓰기의 파일 선택·드롭·이미지 붙여넣기는 기존 multipart `file` 업로드 API를 사용. 요청에는 ADMIN JDBC 세션 쿠키와 현재 `X-CSRF-TOKEN` 필요. 서버가 JPEG/PNG 시그니처·디코딩과 크기를 검증하고 READY 응답의 ID만 문서 이미지 블록에 삽입. 진행 중 저장·출간 중단 안내, 실패·취소 뒤 자동 재업로드 없음. 원고나 로그인 상태를 바꾼 뒤 돌아온 성공 응답은 새 문서에 삽입하지 않음.

편집기는 실제 Markdown 이미지 노드에서 ID를 수집해 글·편집본 저장에 `attachmentIds` **전체 목록**을 명시적으로 보냄. 지원 이미지가 없으면 `[]`를 전송해 이전 연결을 해제하며, 목록은 최대 100개. 코드·일반 문장·링크의 ID는 새 연결로 취급하지 않음. 같은 ID를 둘 이상의 지원 이미지가 사용하면 문서의 마지막 참조가 사라질 때 목록에서 제외. 이 목록 제거는 해당 글의 읽기 권한 철회이며 OCI 객체 삭제가 아님. 글/편집본 삭제도 객체를 자동 삭제하지 않음. 업로드 취소나 응답 불확실 상황에서 미참조 객체가 남을 수 있으므로, 자동 일괄 정리 없이 아래의 정확한 소유 접두사·ID 점검 절차 사용.

관리자 미리보기는 관리자 content 경로, 출간 글 본문은 글 ID와 첨부 ID의 권한별 content 경로를 사용. Spring의 현재 권한 판정 뒤 JPEG/PNG 바이트를 받으며 버킷 직접 URL·서명 URL·외부 이미지 URL은 브라우저에 제공하지 않음. 새 화면은 허용 MIME/크기·API origin·혼합 콘텐츠·redirect를 확인하고 blob URL을 사용한 뒤 해제. 공개 HTTPS API 주소와 교차 site `SameSite=Lax` 쿠키 정책은 미정이며 Pages에서 로그인·PRIVATE 이미지를 읽는 기능은 아직 없음. 2026-09-26 완료한 격리 브라우저 검증에서 파일 선택·격리 클립보드 Ctrl+V·합성 DataTransfer 드롭의 실제 OCI 업로드와 문서 이미지 저장·재열기·출간을 확인. 한 단계 접기 안 이미지를 포함한 총 3개 중 문서 참조 1개를 제거한 뒤 나머지 연결 2개와 제거된 객체의 OCI READY 상태를 확인. 물리적 드롭·운영체제 클립보드의 일반 환경 검증은 아직 아님. 업로드 결과 지연 중 경로 전환·취소 시 다른 문서 삽입 없음, 주입한 업로드/이미지 `503`과 CSRF `403`의 원고 유지·명시적 재시도, 잘못된 형식·과대 파일의 사전 거부 확인. 일곱 너비 라이트·다크 이미지 화면 넘침 0, 검사한 네 화면 Axe 위반 0건·미처리 오류 0건. API 미설정 별도 정적 빌드의 요청 0건·가짜 이미지 0건 확인. 검증 소유 post·draft·연결·첨부를 정리하고 모든 OCI key HEAD `404`와 정확한 소유 접두사 비움을 확인. 전용 API·MySQL·볼륨 제거 뒤 기존 앱·Redis ID·이미지·시작 시각 불변. main 반영 전.

## MySQL 상태와 중간 실패

Flyway V4의 `attachments` 행은 `object_key` 고유 제약과 `uploaded_by` 사용자 FK를 가짐. `uploaded_by`는 DB에서 사용자 ID를 참조하며 HTTP 응답의 `uploadedBy`는 계정명. 내부 `pending_cleanup` 열은 결과가 불확실한 PUT의 지연 완료에 대비해 DELETING 행을 유예하는 표식이며 HTTP 응답에는 없음. 상태는 다음 세 값만 사용.

| 상태 | 의미 | 운영 조치 |
| --- | --- | --- |
| `PENDING` | 업로드 전 행을 기록했거나 OCI 업로드·READY 확정이 끝나지 않음 | 2분 이상 지난 뒤 해당 ID와 실행별 접두사를 확인하고 관리자 DELETE로 정리 |
| `READY` | OCI 원본 업로드와 DB 확정 완료 | 관리자 다운로드 가능. P2-03A 관계 적용 뒤 참조 중이면 삭제 `409` |
| `DELETING` | 삭제 대상임을 DB에 기록했으나 객체 또는 행 삭제가 끝나지 않음 | 오래된 PENDING에서 전환된 행은 2분 유예 뒤, 나머지는 장애 해소 뒤 같은 ID로 DELETE 재시도 |

DB와 OCI Object Storage 사이에는 단일 트랜잭션이 없음. 업로드는 PENDING 행 기록→OCI 전송→READY 갱신 순서이며 두 저장이 모두 끝났을 때만 `201`. PUT 결과가 불확실하거나 READY 확정에 실패하면 이번 요청이 만든 객체만 보상 삭제하고, 추적 가능한 DELETING 행에 `pending_cleanup`을 남길 수 있음. DB 장애로 그 상태 전환조차 확정할 수 없다면 원래 PENDING 행이 남을 수 있음. READY 삭제는 DELETING 기록→OCI 객체 삭제→DB 행 삭제 순서. OCI 삭제 실패 시 DELETING 행을 유지하고, 이미 없는 객체는 다시 삭제를 시도해 DB 행 정리 가능. 오래된 PENDING의 삭제는 늦게 완료될 수 있는 PUT을 고려해 DELETING으로 바꾸고 객체 삭제를 시도한 뒤 **2분 더 행을 유지**. 그 뒤 같은 ID의 DELETE 재시도로 행을 제거. 2분 유예는 늦은 PUT 위험을 줄이지만 원격 완료가 절대 없음을 증명하지 않으므로 남은 행·객체를 확인하며 재시도. 외부 네트워크 요청 동안 DB 트랜잭션을 열어 두지 않음. 자동 복구 배치·전체 버킷 탐색·일괄 삭제는 없음.

## 읽기 전용 점검과 제한적 정리

P2-03A 관계에 따라 삭제 전 `post_attachments`·`editor_draft_attachments`에서 **해당 첨부 ID의 참조만** 읽기 전용으로 확인하고, 참조가 있으면 글·편집본 관리자 경로에서 명시적으로 해제. 본문 문자열만 변경해서는 연결이 해제되지 않음. 부모 글·편집본 삭제는 참조 행만 제거하고 객체 정리는 별도 관리자 DELETE가 필요.

먼저 검증 실행에 사용한 정확한 `OCI_OBJECT_STORAGE_KEY_PREFIX`를 확인하고, 해당 접두사 아래의 **이번 기능 ID만** 조회. 다음은 읽기 전용 SQL 예시. 실제 접두사를 대입하되, 비밀 설정은 SQL·출력에 포함하지 않음. `LIKE` 와일드카드가 아닌 문자열 앞부분 비교를 사용.

```sql
SELECT id, status, pending_cleanup, object_key, uploaded_by, created_at, updated_at
FROM attachments
WHERE LEFT(object_key, CHAR_LENGTH('ken-blog/attachments/<이번-검증-접두사>/'))
    = 'ken-blog/attachments/<이번-검증-접두사>/'
  AND status IN ('PENDING', 'DELETING')
ORDER BY updated_at, id;
```

`GET /api/v1/admin/attachments/{id}`로 찾은 ID와 상태를 확인. 필요하면 정확한 object key에 대해서만 외부 읽기 전용 객체 조회로 존재 여부를 대조. 정리가 필요한 **각 ID**에 관리자 인증·CSRF를 갖춰 DELETE 요청하고 다시 메타데이터 조회와 같은 접두사의 읽기 전용 SQL로 결과를 확인. 2분이 지나지 않은 PENDING은 건드리지 않고, 오래된 PENDING에서 DELETING으로 바뀐 행은 늦은 PUT에 대비해 2분 더 기다린 뒤 재시도. DELETE 중 장애가 나면 남은 PENDING·DELETING ID에 대해서만 재시도. 이미 없어진 객체도 해당 ID의 삭제 절차로 정리. 다른 접두사, 기존 버킷 객체, 다른 앱의 파일은 조회·삭제 대상으로 확대하지 않음. DB 행을 수동으로 지우거나 버킷 전체/접두사 전체를 CLI로 일괄 삭제하면 중간 상태 추적이 끊기므로 이 절차에 포함하지 않음.

## 확인한 실행 결과

2026-09-25 격리 실행에서 `-DskipTests clean package`와 Buildpacks 이미지 생성 성공. 관리자 Spring HTTP 경로에서 PNG·JPEG 업로드 `201` 및 READY 메타데이터, 메타데이터 조회 `200`, HTTP 다운로드 원본과 실제 OCI 객체의 바이트 일치, 안전한 다운로드 헤더 확인. 익명 요청 `401`, 일반 사용자 `403`, CSRF 누락 `403`, 손상·위장 이미지 `415`, 경로형 파일명 `400`, 10 MiB를 1바이트 초과한 파일 `413`도 확인. 같은 세션을 유지한 API JAR 재시작 후에도 다운로드 바이트 일치. 삭제 `204` 후 메타데이터 `404`와 실제 OCI 객체 HEAD `404` 확인.

Buildpacks 이미지의 격리 Compose API·MySQL은 정상 기동. 그 이미지에서도 PNG 업로드 `201`·다운로드 바이트 일치·삭제 `204`·메타데이터 `404`를 확인했고, 실행별 객체 접두사는 정리 후 비어 있음. 패키징된 `/v3/api-docs`에 multipart 관리자 경로 포함. 검증 Compose 프로젝트와 전용 볼륨 제거. 이 결과는 격리된 API·DB·실행별 object key 접두사의 검증이며 공개 API 배포나 Pages 업로드 화면의 검증이 아님.

격리 장애 주입에서는 더미 키와 접근 불가한 로컬 HTTPS endpoint를 사용. OCI 읽기·삭제는 `503`, 실패한 삭제는 DELETING 행을 유지했고 복구된 endpoint에서 같은 ID로 재시도해 `204`를 확인. 업로드 PUT 실패도 `503`과 불확실 전송의 DELETING 추적 행을 남겼으며 유예 중 재시도는 `409`. 검증 DB의 `updated_at`을 인위적으로 지난 시각으로 바꾼 뒤 같은 ID의 DELETE로 `204`를 확인. 또 검증 전용 행을 READY에서 PENDING으로 바꿔 **중단된 PUT 상태를 모사**했을 때 새 PENDING 삭제 `409`, `created_at`을 3분 전으로 바꾼 첫 삭제 `409`와 DELETING 전환, `updated_at`을 3분 전으로 바꾼 재시도 `204`·OCI HEAD `404`를 확인. 검증 DB의 임시 트리거로 실제 PUT 이후 READY 갱신을 거부한 경우에는 안전한 `500`과 남은 PENDING 행을 확인하고 위 두 단계로 정리. 임시 트리거는 검증 DB의 별도 관리 권한으로만 만들었으며 애플리케이션 DB 계정 권한은 바꾸지 않음. 이는 **상태·시각 인위 변경을 통한 재시도 검증**이며 실제 프로세스 강제 종료나 벽시계 2분 대기 시험은 아님.

검증용 MySQL만 중단했을 때 첨부 메타데이터 GET은 약 30.0초 뒤 `application/problem+json`의 `503`을 반환. 같은 MySQL을 재시작한 뒤 기존 쿠키의 `/api/v1/auth/me`는 ADMIN `200`. 종료 시 검증 DB의 첨부 행은 0개, 실행별 정확한 object key 접두사는 비어 있음을 확인. 기존 VM 앱·Redis에는 이 검증을 적용하지 않음.

이에 앞선 **별도 Python S3 호환 클라이언트** 사전 확인에서는 이번 검증 접두사의 PNG 객체 1개를 PUT하고 GET 바이트 일치·DELETE 후 HEAD `404`를 확인. 기본 AWS chunked encoding 요청은 OCI endpoint가 `NotImplemented`로 거부했으며, 선택적 요청·응답 checksum 계산을 필요한 경우로 제한한 설정에서 성공. Spring의 Java SDK 클라이언트는 SigV4·path-style, chunked encoding 끄기, 요청·응답 checksum `WHEN_REQUIRED`로 구성. 연결 제한 5초, 소켓 30초, API 호출 전체 30초로 설정.
