# 위키 제목 조회 API

P2-06A의 `[[글 제목]]` 대상 확인을 위한 API 계약. API 구현·격리 HTTP 검증 완료. 이 문서의 요청·응답 예시는 형식 설명이며 실제 운영 데이터가 아님. 공개 Markdown 화면의 위키 링크 파싱·표시와 관리자 링크 선택기는 후속 단계. 기존 글·DB 스키마·공개 HTTPS API 연결과 운영 배포는 변경하지 않음.

## 요청과 결과

`GET /api/v1/wiki-links/resolve`에 `title` 쿼리를 반복해 1~20개 전달. 같은 제목을 반복해도 입력 순서와 중복을 유지하며 각 값마다 결과 한 개를 `items` 배열에 반환할 계약. 쉼표는 제목의 일부이므로 `title=A%2CB&title=다른%20제목`처럼 각각 별도 쿼리로 인코딩. `requestedTitle`은 요청 값의 앞뒤 공백을 제거한 문자열. 결과 상태와 필드는 다음과 같음.

| 상태 | 의미와 반환 필드 |
| --- | --- |
| `READABLE` | 읽을 수 있는 출간 Tech 글. `requestedTitle`, `status`, 이동에 필요한 `id`, `title`, `slug`만 반환 |
| `LOCKED` | 익명에게 비공개인 출간 Tech 글. `requestedTitle`, `status`만 반환 |
| `MISSING` | 대상이 없거나 초안. `requestedTitle`, `status`만 반환 |

응답 형태 예시. 실제 저장된 글이나 지금 조회 가능한 운영 API의 결과를 뜻하지 않음.

```json
{
  "items": [
    { "requestedTitle": "공개 글", "status": "READABLE", "id": 1, "title": "공개 글", "slug": "public-post" },
    { "requestedTitle": "비공개 글", "status": "LOCKED" },
    { "requestedTitle": "없는 글", "status": "MISSING" }
  ]
}
```

익명은 PUBLIC만 읽을 수 있고 PRIVATE의 존재 여부는 `LOCKED`로만 표시. USER·ADMIN 세션에는 현재 읽기 권한이 있는 PRIVATE의 이동 필드 제공. `LOCKED`와 `MISSING`에는 대상의 ID·제목·slug 필드 자체가 없으며 본문·분류·태그·첨부 메타데이터도 반환하지 않음. 이 API는 PRIVATE 글 목록이나 본문 탐색을 추가하지 않음. 응답을 읽을 수 있는 경우에도 본문 열을 조회하지 않는 경계.

## 제목 비교와 입력 제한

요청 제목은 앞뒤 공백을 제거한 뒤 비교하고 대소문자는 구분하지 않음. 악센트가 다른 글자는 같은 제목으로 간주하지 않음. MySQL 소문자 변환 결과를 이진 비교하는 방식으로 일관성 유지. 동일 제목의 출간 글이 여러 개면 최초 출간 시각 오름차순, 이어서 ID 오름차순으로 한 개 선택. 제목 중복을 새로 금지하거나 기존 글을 수정하지 않음. 제목·출간 상태가 바뀌거나 글이 삭제되면 이후 조회 결과도 바뀔 수 있음.

요청은 `title` 1~20개, 각 값은 공백 제거 후 1~200 Unicode codepoints. 디코딩된 원 입력값들의 UTF-8 바이트 합계는 1,500바이트 이하이고 URL 인코딩된 쿼리 문자열은 UTF-8 6,144바이트 이하. 빈 값·제어 문자·개행·알 수 없는 쿼리 이름·개수/길이/합계 초과는 기존 `ProblemDetail` 400 대상. 쉼표나 SQL 모양 문자열은 분리자나 쿼리로 실행하지 않고 제목 값으로 처리. 입력값은 바인딩된 조회에 사용하며, 제목 수에 상한을 두어 요청 하나의 조회 비용 제한.

## 인증·CORS·캐시 경계

익명 GET을 허용하되 PRIVATE 이동 정보는 명시적 USER·ADMIN 세션에서만 제공할 계약. JDBC 세션·권한 판별과 기존 오류 흐름 유지. 성공 응답은 `Cache-Control: no-store`. 공개 GET origin은 `APP_CORS_ALLOWED_ORIGINS`에 적힌 정확한 주소만 허용하며 자격 증명 CORS 응답은 허용하지 않음. 쿠키가 필요한 GET은 `APP_AUTH_CORS_ALLOWED_ORIGINS`의 정확한 주소에만 자격 증명 CORS 허용. 공개 origin의 자격 증명 미허용은 브라우저의 CORS 응답 접근 규칙이며 서버가 전달된 쿠키를 별도로 무시한다는 뜻은 아님. POST 등의 다른 메서드나 CSRF 예외는 추가하지 않음. DB 장애는 기존 내부 정보 없는 503 `ProblemDetail` 경계.

이 단계는 API와 데이터 조회만 변경. 공개 Pages에는 API HTTPS 주소가 여전히 설정되지 않았고, 실제 `[[...]]` 클릭·잠금·없는 링크 화면은 아직 없음.

## 격리 검증 상태

2026-09-26 기존 API 검사 28개와 `clean verify` 성공. 이후 Swagger 명세 보완만 적용해 테스트 실행 없이 최종 패키지를 생성하고, 그 JAR의 실제 HTTP·OpenAPI를 별도 검증. 격리 MySQL·API HTTP에서 반복 제목과 쉼표·공백 제거·대소문자·악센트·한글·200개 이모지 codepoints·SQL 모양 문자열을 제목 값으로 처리한 결과 확인. 원 입력 UTF-8 합계 정확히 1,500바이트는 허용하고 1,501바이트는 400, 제목 20개는 허용하고 21개는 400. 제어 문자와 알 수 없는 쿼리 키도 400 확인. 같은 제목의 최초 출간 시각·ID 동률 처리에서 첫 대상이 PRIVATE이면 익명에게 `LOCKED`를 반환하고 뒤의 PUBLIC으로 우회하지 않음.

PUBLIC·PRIVATE의 익명/USER/ADMIN/로그아웃 결과와 초안 `MISSING`, 출간 철회·제목 변경·삭제의 즉시 반영 확인. `LOCKED`·`MISSING`에 대상 메타데이터 필드가 없고, 익명 조회가 새 세션을 만들지 않음. `no-store`, 공개/인증 origin별 CORS, POST 거부 확인. 서로 다른 제목 두 개와 중복 제목 하나의 SQL은 메타데이터 조회 2건이며 본문 열을 선택하지 않음. 소유 DB 중단 중 익명·세션 요청의 503 확인. DB 복구 후 기존 로그인 세션 유지 확인. 최종 JAR의 OpenAPI에서 반복 title의 문자열 항목·필수 응답 필드·상태별 oneOf/discriminator를 확인했고, 익명 세 상태·관리자 PRIVATE·로그아웃 응답도 재확인. 검증 API를 중지하고 소유 MySQL 컨테이너·볼륨을 삭제했으며 기존 앱·Redis ID·이미지·시작 시각은 그대로. OCI 미사용. 이 기록은 격리 실행 결과이며 main·CI·Pages 반영 전, 기존 운영 배포와 공개 HTTPS API 연결은 변경 없음.
