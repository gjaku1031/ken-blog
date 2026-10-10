# Vowser 서버 간 응답 섞임 재현 (2026-10-09~10)

분류: 결함 재현. Spring Boot가 에이전트 서버로 보낸 요청과 돌아온 응답을 요청 번호 없이 "대기 목록의 첫 항목"에 연결하는 구조(`McpWebSocketClient`)에서, 응답이 실제로 다른 요청으로 가는지 확인함.

- 대상: vowser-backend 커밋 `8ea334c`의 `McpWebSocketClient`를 고치지 않고 사용. 테스트 파일 하나와 `build.gradle`의 테스트 의존성 한 줄(`com.squareup.okhttp3:mockwebserver:4.12.0`)만 더함
- 가짜 에이전트 서버: OkHttp MockWebServer. 실제 에이전트처럼 받은 순서대로 하나씩 답하고, 응답에 어느 요청의 답인지 표시함
- 실행: `gradle test --tests com.vowser.backend.infrastructure.mcp.McpResponseMixupTest` (Gradle 8.14.2, JDK 21 컨테이너)

| 시나리오 | 운영 코드에서 쓰이나 | 결과(각 10회) |
| --- | --- | --- |
| `twoConcurrentSearchesAfterNineRequests`: 앞선 요청 9건 뒤 검색 두 건을 동시에 보냄(요청 번호 10·11) | 쓰임(REST 경로 검색) | 10/10 두 요청이 서로의 응답을 받음 |
| `contributionBatchWhileSearchPending`: 한 사용자의 기록 배치(`sendContributionData`)가 처리되는 동안 다른 사용자의 검색이 대기 | 쓰임(`ControlWebSocketHandler`가 기록 모드의 5단계 배치를 넘김) | 10/10 검색 요청이 기록 배치의 결과를 받고, 검색 결과는 앱으로 중계됨 |
| `voiceCommandWhileApiRequestPending`: 음성 명령 전송(`sendVoiceCommand`) 중 API 요청이 대기 | 쓰이지 않음(호출하는 곳 없음). 참고용 | 10/10 섞임 |

`test-result.xml`은 마지막 실행의 JUnit 결과(30개 통과)임.
