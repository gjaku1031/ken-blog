이미지 응답의 간헐적 연결 종료를 줄이기 위해 비동기 스트리밍을 같은 servlet 요청 스레드의 전송으로 변경한 사례.

## 증상과 재현

2026-10-02 기술 목록 정리 후 실제 HTTP 검사에서 아이콘·본문 첨부의 간헐적 연결 종료와 손상 헤더 관찰. 변경 전 JAR에서도 아이콘 150회 중 1회 연결 종료. 새 기능 변경만으로 원인을 한정할 수 없는 상태.

| 관찰 | 조사 방향 |
| --- | --- |
| 대부분의 요청은 성공 | 항상 잘못된 경로나 파일과 구분 |
| 변경 전 JAR에서도 재현 | 최근 기능 삭제 외 기존 응답 처리 조사 |
| Tomcat MimeHeaders 예외 | 이미지 내용 외 헤더 작성 시점 확인 |
| 비동기 본문과 Security 헤더 처리 | 같은 응답 객체를 다루는 실행 흐름 확인 |

API 직접 호출과 Caddy 경유 요청을 함께 확인. 1/150은 당시 반복 검사의 관측값이며 운영 실패율 추정치로 사용하지 않음.

## 원인 판단

당시 로그와 `HeaderWriterFilter` 소스 조사에서 `StreamingResponseBody`의 비동기 전송과 Security 헤더 작성의 경합 구조 확인. 수정 대상은 파일 저장 방식보다 헤더 설정과 본문 전송의 실행 순서.

정확한 스레드 순서를 고정한 최소 재현 프로그램은 기록에 없음. 이 서비스에서 관찰한 경합을 모든 비동기 스트리밍의 결함으로 일반화하지 않음.

## 조치

아이콘·첨부 응답의 `StreamingResponseBody` 제거. 같은 요청 스레드에서 헤더를 설정하고 `InputStream.copyTo`로 전송. 스트림은 `use`로 닫으며 전체 파일을 메모리에 적재하지 않음.

1. 글 공개 조건·첨부 연결·READY 상태 검사.
2. 저장소 경로 검사와 파일 열기.
3. MIME·길이·캐시·보안 헤더 설정.
4. 본문 전송.
5. 성공·실패 모두에서 입력 스트림 종료.

권한·파일 열기 실패는 헤더 확정 전에 처리해 기존 404·503 계약 유지. 전송을 시작한 뒤의 실패는 새 JSON 응답으로 바꾸지 못할 수 있음.

## 선택의 비용

| 방식 | 고려할 비용 |
| --- | --- |
| 비동기 전송 유지 | 필터·전송의 헤더 변경 순서를 추가 조정해야 함 |
| 전체 파일 메모리 적재 | 동시 요청에 따른 파일 크기만큼 메모리 필요 |
| 보안 헤더 제거 | 기존 보안 응답 계약 변경 |
| 같은 요청 스레드에서 전송 | 헤더·본문 순서를 한 흐름으로 정리, 전송 동안 요청 스레드 점유 |

동기 스트리밍 채택. 최대 10MiB 본문 이미지·64px 기술 아이콘 용도에 한정한 선택이며, 대안 간 독립 성능 비교는 미실시.

## 수정 당시 검증

| 검사 | 결과 |
| --- | --- |
| API 직접·Caddy·공개/관리자 첨부 혼합 | 동시 요청 4개, 총 750회에서 오류 0 |
| HEAD | 30회에서 오류 0 |
| 응답 계약 | 캐시·MIME·nosniff·X-Frame-Options·본문 길이·해시 유지 |
| 파일 디스크립터 | 전후 25 → 27 |
| 잘못된 DB 키·심볼릭 링크 | 경로 비노출 503 유지 |

당시 관리자 첨부 API는 후속 변경에서 제거. 검증 수치는 제거 전 기능을 포함한 과거 결과. 750회 성공과 파일 디스크립터 두 시점만으로 장기 무오류·누수 부재를 증명하지 않음.

## 현재 구현과 회귀 검사

공개 첨부·기술 아이콘 Controller는 같은 요청 스레드에서 전송하는 계약 유지. 첨부는 `private, no-store`, 기술 아이콘은 `public, max-age=300`으로 캐시 정책 구분.

전송 서비스는 MIME·1바이트~10MiB 범위와 실제 파일 크기 대조. `AttachmentDeliveryTest`는 잘못된 MIME, 0·음수·상한 초과·크기 불일치 거부를 검사. 이 검사는 전송 전 입력 계약이며 과거 헤더 경합의 장시간 재현 시험과 별개.

## 재검토 조건

대용량 파일·느린 연결·동시 다운로드 증가 시 요청 스레드 점유와 대기·오류·응답 시간을 함께 측정. 비동기 방식 재도입 여부는 헤더 경계 재현과 부하 비교 후 판단.

[이미지 응답 결정·검증 기록](https://github.com/gjaku1031/ken-blog/blob/3074d80/docs/ADR/ADR_application.md#이미지-응답의-동기-스트리밍) · [공개 첨부 Controller](https://github.com/gjaku1031/ken-blog/blob/3074d80/src/main/java/io/github/gjaku1031/kenblog/attachment/controller/PostAttachmentController.java) · [기술 아이콘 Controller](https://github.com/gjaku1031/ken-blog/blob/3074d80/src/main/java/io/github/gjaku1031/kenblog/stack/controller/StackBadgeController.java) · [전달 검사](https://github.com/gjaku1031/ken-blog/blob/3074d80/src/test/java/io/github/gjaku1031/kenblog/AttachmentDeliveryTest.java)
