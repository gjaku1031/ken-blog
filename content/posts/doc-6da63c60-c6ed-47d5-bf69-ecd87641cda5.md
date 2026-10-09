API는 앱이 호출하는 Spring Boot의 REST API와, Spring Boot가 에이전트 서버를 부르는 WebSocket 메시지 두 층으로 나뉨. 경로 API는 REST 요청을 WebSocket 메시지로 바꿔 전달하고 응답을 기다리며(P1·P2), 경로의 단계 구조는 앱의 기록기·에이전트의 저장소·앱의 실행기가 함께 쓰는 계약임. 전체 경로와 필드의 원본은 코드임.[* [경로 API 컨트롤러](https://github.com/Vovvser/vowser-backend/blob/488d8ea/src/main/java/com/vowser/backend/api/controller/PathManagementController.java) · [음성 API 컨트롤러](https://github.com/Vovvser/vowser-backend/blob/488d8ea/src/main/java/com/vowser/backend/api/controller/SpeechController.java) · [인증 API 컨트롤러](https://github.com/Vovvser/vowser-backend/blob/488d8ea/src/main/java/com/vowser/backend/api/controller/AuthController.java) · [에이전트 메시지 처리](https://github.com/Vovvser/vowser-agent-server/blob/d94eaf5/app/main.py) · [단계 모델](https://github.com/Vovvser/vowser-agent-server/blob/d94eaf5/app/models/step.py)]

## 설계 원칙

| 결정 | 내용 | 이유·대가 |
| --- | --- | --- |
| 앱은 Spring Boot만 호출 | 앱 코드에는 에이전트 서버 주소가 없고, 경로 요청도 Spring Boot를 거침 | 앱이 아는 서버 주소가 하나뿐임. 대가로 경로 요청은 서버를 두 번 거침. 경로 API 자체는 인증 없이 열려 있음([보안 설계](/ken-blog/post/doc-005871e6-b37a-4873-bbab-0f93aaf467e2/)) |
| 서버 간은 WebSocket 연결 하나 | Spring Boot가 시작할 때 에이전트 서버에 연결하고, 끊기면 20초 뒤 재연결함. 메시지는 `type`과 `data`로 구분 | 서버 팀원이 정한 구조로, 요청마다 연결을 맺지 않음. 대가로 요청과 응답을 짝짓는 방법을 직접 만들어야 함(아래 계약) |
| 경로 API는 비동기 응답 | 컨트롤러가 `CompletableFuture`를 반환해, 에이전트 응답을 기다리는 동안 요청 스레드를 붙잡지 않음 | 응답이 30초 안에 오지 않으면 실패로 끝냄 |
| 검색 응답은 그대로 전달 | 검색 API는 에이전트의 JSON 문자열을 해석하지 않고 앱에 넘김 | 에이전트의 응답 구조가 곧 앱의 계약이 됨. 필드가 바뀌어도 백엔드 수정이 필요 없지만, 백엔드에서 응답을 검증하지 않음 |
| 음성 인식과 검색 분리 | 음성 API는 인식 문장만 반환하고, 앱이 그 문장으로 검색 API를 다시 부름 | 앱이 인식 결과를 화면에 보여 주고 기록 모드에서는 작업 이름으로 쓸 수 있음. 대가로 왕복이 한 번 늘어남 |

> 서버는 경로를 해석하지 않고 옮기기만 하며, 경로의 단계 구조는 기록기·저장소·실행기 세 곳이 같은 필드로 읽고 씀.

## 경로 단계 계약

기록기가 만든 단계가 그대로 저장되고, 검색 응답으로 실행기에 돌아옴. 세 구성 요소가 같은 필드를 쓰기 때문에 필드 하나의 의미가 바뀌면 세 곳을 함께 바꿔야 함.

```json
{
  "sessionId": "c1f0…",
  "taskIntent": "오늘 날씨 보기",
  "domain": "naver.com",
  "steps": [
    {
      "url": "https://www.naver.com",
      "domain": "naver.com",
      "action": "input",
      "selectors": ["#query", "input[name='query']", "input[type='search']"],
      "description": "검색창에 '날씨' 입력",
      "textLabels": ["검색"],
      "isInput": true,
      "inputType": "search",
      "inputPlaceholder": "날씨",
      "shouldWait": false
    }
  ]
}
```

`POST /api/v1/paths`의 요청 예시(값은 설명용). 필드의 쓰임은 다음과 같음.

| 필드 | 기록기(앱) | 저장소(에이전트) | 실행기(앱) |
| --- | --- | --- | --- |
| `selectors` | `id`·`href`·`name`·`data-testid`·`aria-label`·텍스트 순으로 여러 선택자를 만듦 | 첫 선택자를 단계 ID 계산에 씀 | 앞에서부터 시도하고 실패하면 다음 선택자로 |
| `action` | `type`→`input`처럼 정규화, 모르는 동작은 `click` | 그대로 저장 | 동작별 실행 규칙 선택 |
| `inputType`·`inputPlaceholder` | 비밀번호·이메일·아이디 칸이 아니고 20자 이하면 입력값을, 아니면 HTML placeholder를 넣음 | 그대로 저장 | 값이 있으면 그 값을 입력하고, 없으면 사용자에게 물음 |
| `shouldWait`·`waitMessage` | 기록에서는 항상 `false` | 그대로 저장 | `wait` 단계에서 문구를 보여 주고 사용자 확인까지 대기 |
| `description`·`textLabels` | 요소의 텍스트·라벨로 설명 생성 | 단계 임베딩의 원문 | 진행 표시 문구 |

`inputPlaceholder`에 입력값과 HTML placeholder 문구가 같은 필드로 들어가, 실행기는 둘을 구분하지 못하고 placeholder 문구도 입력값으로 넣음. 단계 수의 상한은 API에 없고, 저장은 되어도 경로 복원이 `NEXT_STEP` 20개까지만 따라가 그보다 긴 경로는 잘림.[* [경로 저장 변환](https://github.com/Vovvser/vowser-client/blob/8065803/shared/src/commonMain/kotlin/com/vowser/client/api/PathApiClient.kt) · [경로 실행기](https://github.com/Vovvser/vowser-client/blob/8065803/shared/src/commonMain/kotlin/com/vowser/client/api/PathExecutor.kt)]

## REST와 WebSocket 사이의 요청 연결

경로 API 요청 하나는 에이전트 서버로 가는 메시지 하나가 됨. 메시지의 `type`이 에이전트의 처리를 정함.

| REST 요청 | 메시지 `type` | 응답 |
| --- | --- | --- |
| `POST /api/v1/paths` | `save_new_path` | 저장 결과와 저장한 단계 수 |
| `GET /api/v1/paths/search` | `search_new_path` | `matched_paths`(도메인·의도·유사도·가중치·단계 목록), 처리 전략 |
| `GET /api/v1/paths/popular`, `/graph/stats`, `/graph/visualize/{domain}` | `find_popular_paths`, `check_graph`, `visualize_paths` | 운영 조회 결과 |
| `POST /api/v1/paths/admin/indexes`, `/admin/cleanup` | `create_new_indexes`, `cleanup_paths` | 인덱스 생성·연결 정리 결과 |

Spring Boot는 보낼 때마다 요청 번호를 만들어 응답 대기 목록에 넣고 30초 시간 제한을 걺. 그런데 번호는 메시지에 실리지 않고, 응답이 오면 대기 목록에서 꺼낸 첫 항목에 연결함. 대기 목록은 순서를 보장하지 않는 해시 맵이고 에이전트도 번호를 돌려주지 않으므로, 두 요청이 동시에 대기 중이면 응답이 뒤바뀔 수 있음. 대기 중인 요청이 없을 때 온 메시지는 브라우저 제어 채널로 마지막에 연결된 앱에 중계됨.[* [에이전트 WebSocket 클라이언트](https://github.com/Vovvser/vowser-backend/blob/488d8ea/src/main/java/com/vowser/backend/infrastructure/mcp/McpWebSocketClient.java) · [제어 채널 서비스](https://github.com/Vovvser/vowser-backend/blob/488d8ea/src/main/java/com/vowser/backend/application/service/ControlService.java)]

에이전트 서버는 연결 하나의 메시지를 받은 순서대로 하나씩 처리하고, 검색 1위의 가중치 증가만 별도 작업으로 떼어 실행함. 그래서 응답은 요청 순서대로 돌아오지만, 백엔드가 순서가 아닌 해시 맵의 첫 항목으로 짝을 지어 이 순서를 활용하지 못함.

이 구조에서 응답이 실제로 뒤바뀌는지 재현함. 실제 백엔드 클라이언트 코드를, 받은 순서대로 하나씩 답하는 가짜 에이전트 서버에 연결했고, 두 경우 모두 10회 반복에서 매번 같은 결과가 나왔음.[* 2026-10-09, 백엔드 커밋 `8ea334c`에 JUnit 테스트만 더해 JDK 21에서 실행. 가짜 서버는 OkHttp MockWebServer로 만들고, 받은 검색어를 응답에 되돌려 줘 어느 요청의 응답인지 구분함]

- 앞선 요청 9건을 끝낸 뒤 두 검색을 동시에 보내면(요청 번호 10·11) 해시 맵에서 "11"이 "10"보다 앞에 놓여, 두 요청이 서로의 응답을 받음
- 음성 명령의 검색이 처리되는 동안 관리자 API 요청이 대기 중이면, API 요청이 음성 명령의 응답을 가져가고 API의 응답은 사용자 앱으로 중계됨

한 사람이 순차로 쓰면 대기 중인 요청이 하나뿐이라 드러나지 않음. 보강 방향은 [주요 기술적 의사결정](/ken-blog/post/doc-d8735f2c-c9bf-45fa-bcac-a692eb4dc739/)의 한계 절에 있음.

인증 API의 토큰 교환과 쿠키 속성은 [보안 설계](/ken-blog/post/doc-005871e6-b37a-4873-bbab-0f93aaf467e2/)에서 다룸.
