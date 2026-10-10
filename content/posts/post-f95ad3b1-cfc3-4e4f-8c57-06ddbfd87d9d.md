2026-10-02 실제 HTTP 검사에서 기술 아이콘과 본문 첨부 응답이 간헐적으로 연결 종료되거나 헤더가 손상되는 현상을 발견함. 원인은 비동기 본문 전송과 Spring Security의 헤더 작성이 같은 응답 객체를 다른 스레드에서 다루는 경합으로 판단했고, 이미지 응답을 요청 스레드 안의 동기 전송으로 바꿈. 원인 조사와 수정은 에이전트가 맡았고, 공통 응답 처리까지 수정 범위를 넓히는 결정과 검증 결과 확인은 직접 함.

## 증상

| 관찰 | 의미 |
| --- | --- |
| 대부분의 요청은 성공 | 잘못된 경로나 파일처럼 항상 실패하는 문제가 아님 |
| 변경 전 JAR에서도 아이콘 150회 중 1회 연결 종료 | 직전 기능 변경 전부터 있던 문제 |
| Tomcat `MimeHeaders` 예외 | 헤더를 쓰는 시점에 생기는 오류 |
| API 직접 호출과 Caddy 경유 모두 재현 | 프록시와 무관한 API 내부 문제 |

1/150은 당시 반복 검사의 관측값이며 운영 실패율의 추정치가 아님.

## 원인 판단

당시 이미지 응답은 `StreamingResponseBody`로 본문을 비동기 전송했음. 이 방식은 컨트롤러가 반환한 뒤 별도 스레드에서 본문을 씀. 같은 응답에서 Spring Security의 `HeaderWriterFilter`는 응답이 커밋되기 직전에 보안 헤더를 씀. 두 작업이 같은 응답 객체의 헤더를 다른 스레드에서 건드릴 수 있는 구조였고, `MimeHeaders` 예외는 헤더 목록이 동시에 바뀔 때 나는 오류와 맞았음. 비동기 본문 쓰기와 `HeaderWriterFilter`가 경합하는 유사한 구조가 다른 서버·응답 방식(Jetty, SSE)에서 Spring Security 이슈로 보고된 적이 있음.[* [Spring Security 이슈 #9175](https://github.com/spring-projects/spring-security/issues/9175)]

스레드 순서를 고정해 경합을 확정적으로 재현한 최소 프로그램은 만들지 않음. 그래서 이 서비스에서 관찰한 경합을 모든 비동기 스트리밍의 결함으로 일반화하지 않음.

## 조치

이미지 응답에서 `StreamingResponseBody`를 없애고, 같은 요청 스레드에서 헤더를 모두 설정한 뒤 본문을 보냄. 아래는 공개 첨부 컨트롤러의 요약(보안 헤더 두 줄 생략).

```java
var content = service.open(postId, id);      // 발행·연결·경로 검사 후 파일 열기
try (var stream = content.stream()) {
    response.setContentType(content.contentType());
    response.setContentLengthLong(content.byteSize());
    response.setHeader(HttpHeaders.CACHE_CONTROL, "private, no-store");
    stream.transferTo(response.getOutputStream());
}
```

- 권한 확인과 파일 열기는 헤더를 확정하기 전에 끝나므로, 실패하면 기존과 같은 404·503 오류 응답을 보냄
- 파일 전체를 메모리에 올리지 않고 스트림으로 복사하며, 성공·실패 모두에서 try-with-resources로 스트림을 닫음
- 본문 전송을 시작한 뒤의 실패는 이미 보낸 헤더 때문에 오류 응답으로 바꿀 수 없음

## 대안과 대가

| 대안 | 판단 |
| --- | --- |
| 비동기 전송 유지 | 필터와 전송 스레드의 헤더 작성 순서를 따로 맞춰야 함 |
| 파일 전체를 메모리에 올려 응답 | 동시 요청 수 × 파일 크기만큼 메모리가 필요해, 1.5GiB로 제한한 API 컨테이너에 부담이 됨 |
| 보안 헤더 끄기 | 보안 응답 계약이 바뀜 |
| **같은 요청 스레드에서 전송(채택)** | 헤더와 본문 순서가 한 흐름에 있음. 대가는 전송 동안 요청 스레드를 점유하는 것 |

최대 10MiB 본문 이미지와 64px 기술 아이콘이라는 지금 용도에 맞춘 선택이며, 대안 사이의 성능은 따로 비교하지 않음.

## 검증

수정의 근거는 구조임. 헤더와 본문을 같은 요청 스레드에서 차례로 쓰므로 두 쓰기가 겹칠 수 없음. 아래 부하 검사는 수정 뒤에 다른 문제가 생기지 않았는지 확인한 것임.

| 검사 | 결과 |
| --- | --- |
| API 직접·Caddy 경유·공개/관리자 첨부를 섞은 동시 요청 4개, 총 750회 | 오류 0 |
| HEAD 30회 | 오류 0 |
| 응답 계약 | 캐시 정책, MIME, `nosniff`, `X-Frame-Options`, 본문 길이, 내용 해시가 변경 전과 같음 |
| 파일 디스크립터 | 검사 전후 25 → 27. 요청 수에 비례해 늘지 않음 |
| 잘못된 DB 키·심볼릭 링크 | 경로를 드러내지 않는 503 유지 |

당시 검사에 포함된 관리자 첨부 API는 이후 제거됨. 750회 성공과 두 시점의 파일 디스크립터 수만으로는 오래 돌려도 오류나 누수가 없다고 말할 수 없음. 수정 전에는 150회 중 1회 관측됐으므로, 750회 무오류가 보여 주는 것은 실패율이 약 0.4% 아래라는 것까지임.[* 750회 중 0회일 때 실패율의 95% 신뢰 상한은 약 3/750(3의 법칙)]

## 현재 상태와 재검토 조건

공개 첨부와 기술 아이콘 컨트롤러는 같은 요청 스레드에서 전송하는 구조를 유지함. 첨부는 `private, no-store`, 기술 아이콘은 `public, max-age=300`으로 캐시 정책이 다름. `AttachmentDeliveryTest`는 잘못된 MIME과 0·음수·상한 초과·실제 크기 불일치를 전송 전에 거부하는지 검사함. 이 검사는 입력 계약의 검사이며, 헤더 경합을 오래 재현하는 시험은 아님.

큰 파일·느린 연결·동시 다운로드가 늘면 요청 스레드 점유와 대기 시간을 측정하고, 비동기 방식을 다시 쓸지는 헤더 경합 재현과 부하 비교 뒤에 정함.

[결정·검증 기록](https://github.com/gjaku1031/ken-blog/blob/b768152/docs/ADR/ADR_application.md#이미지-응답의-동기-스트리밍) · [공개 첨부 컨트롤러](https://github.com/gjaku1031/ken-blog/blob/b768152/src/main/java/io/github/gjaku1031/kenblog/attachment/controller/PostAttachmentController.java) · [기술 아이콘 컨트롤러](https://github.com/gjaku1031/ken-blog/blob/b768152/src/main/java/io/github/gjaku1031/kenblog/stack/controller/StackBadgeController.java) · [전달 검사](https://github.com/gjaku1031/ken-blog/blob/b768152/src/test/java/io/github/gjaku1031/kenblog/AttachmentDeliveryTest.java)
