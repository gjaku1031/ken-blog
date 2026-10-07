---
name: ken-blog-diagrams
description: ken-blog 게시글·문서의 Mermaid 다이어그램(아키텍처 구성도, 시스템 구조, ERD, 유저 플로우, 시퀀스, 상태도)을 새로 그리거나 고칠 때 반드시 사용. 블로그 렌더러의 제약(금지 문법·노드 ID 예약어·크기 규칙), 캡션과 범례 상자, 로고가 들어가는 고정 배치 구성도 작성 절차, 렌더링 검사·미리보기 스크립트를 포함한다.
---

# ken-blog 다이어그램

블로그의 공용 렌더러(`src/main/resources/web/shared/mermaid-render.ts`)는 Mermaid 원문을 검사한 뒤 그리며, 허용하지 않는 문법은 원문 그대로 표시한다. 그리기 전에 이 파일과 해당 레퍼런스를 읽는다.

| 그릴 것 | 도식 | 먼저 읽을 레퍼런스 |
| --- | --- | --- |
| 모든 도식 공통 | — | [mermaid-common.md](references/mermaid-common.md) |
| 배포 경계·서버·기술 스택(로고) | `architecture-beta` + 고정 배치 | [architecture.md](references/architecture.md) |
| 계층·경로 구조(로고 없이) | `flowchart` | mermaid-common.md |
| 사용자 흐름 | `flowchart TD` | mermaid-common.md |
| 시스템 간 호출 순서 | `sequenceDiagram` | mermaid-common.md |
| 상태 전이 | `stateDiagram-v2` | mermaid-common.md |
| 테이블·키·관계 | `erDiagram` | [erd.md](references/erd.md) |

## 핵심 규칙

- **사실 먼저**: 코드·스키마·배포 설정과 대조해 구성 요소와 연결을 목록으로 만든 뒤 그린다. 보기 좋게 하려고 관계를 빼거나 바꾸지 않는다.
- **로고 구성도는 고정 배치로**: `architecture-beta` 자동 배치는 그룹이 겹치고 노드가 그룹 밖으로 나가 쓸 수 없다. 로고가 필요한 중요 도식(인프라 구성도, 시스템 구조)은 배치 JSON을 만들어 `%% layout: 이름`으로 고정한다. 그 밖의 구조도는 로고 없이 `flowchart`로 그린다.
- **캡션**: 펜스 첫 줄 `` ```mermaid caption="설명" ``. 그림 아래 설명 문단은 두지 않는다.
- **범례는 상자로**: 고정 배치는 JSON `legend`, 그 밖의 도식은 원문에 `%% legend: …`(선 종류, `color:#채움:#테두리` 색 견본, `round`·`diamond` 노드 모양, `zero`·`many` ERD 관계 끝. 문법표는 mermaid-common.md '캡션과 범례'). 색·모양·선 설명("파랑은 ~", "둥근 노드는 ~", "실선은 ~")은 캡션에 쓰지 않는다. 범례를 넣었으면 캡션에서 범례 문장을 빼고 설명만 남긴다. 시퀀스처럼 간단한 도식도 예외 없이 상자로 넣는다(예: 시퀀스 `%% legend: solid=요청; dotted=응답`, 다이어그램 선언 다음 줄에 둠). "실선은 ~, 점선은 ~" 같은 문장을 캡션에 쓰지 않는다.
- **금지**: 노드 ID에 `link`, `click`, `style`, `linkStyle`, `classDef`, `callback`, `cssClass` 같은 지시어 이름, `init`·frontmatter 설정, `style`·`linkStyle`(선 색 지정 불가), HTML 태그(`<br>` 포함), 외부 URL.
- **선 구분**: 선 색을 지정할 수 없으므로 모양으로 구분한다. `==>` 굵은 선, `-->` 실선, `-.->` 점선.
- **노드 색**: `classDef 이름 fill:#RRGGBB,stroke:#RRGGBB,color:#RRGGBB,stroke-width:2px`만. 다크 모드 색은 렌더러가 조정한다.
- **크기**: 확대하지 않음, 기준 글자 14px, ERD 0.85배, 본문의 두 배보다 넓은 가로 흐름도는 `TD`로.
- **라벨 언어**: 아키텍처·시스템 도식은 영어 이름(그룹 제목과 설명은 배치 JSON의 한국어), 기능 흐름도는 한국어.
- **ERD 그룹 제목**: 렌더러가 그룹 왼쪽 위로 옮겨 관계선 끝과 겹치지 않게 한다. 별도 조치 불필요.

## 검증

1. 렌더러 검사: `node .claude/skills/ken-blog-diagrams/scripts/check-mermaid.mts <원고.md>` — 모든 도식이 `ok`여야 한다.
2. 고정 배치를 새로 만들거나 바꿨으면 `.github/pages/mermaid.test.mjs`에 원고·배치 일치 검사를 추가하고 `npm test`.
3. 미리보기: `.claude/skills/ken-blog-docs/scripts/preview.sh <scratchpad>` → `node .claude/skills/ken-blog-docs/scripts/preview-shots.cjs <slug> <저장 디렉터리>`. 출력되는 도식별 표시 크기(원래 폭)와 도식별 캡처(`-d0.png` …)를 Read로 직접 본다. 겹침·잘림·글자 크기·범례 위치를 확인한다.
4. 렌더러나 배치 코드를 고쳤으면 `npm run test:browser`도 실행한다.

## 고정 배치 만들기 요약

자세한 항목 정의는 [architecture.md](references/architecture.md)의 '기존 고정 배치 수정'·'새 프로젝트에 재사용'.

1. 원문 작성: `architecture-beta` 다음 줄에 `%% layout: <새 이름>`, 그룹·서비스(`ken:` 아이콘)·단방향 연결.
2. `src/main/resources/web/shared/<이름>-layout.json` 작성: `width`, `height`, `groups`(`[x, y, w, h, 한국어 제목]`), `services`(`[x, y, 설명]`, 아이콘 타일 44px, 이름·설명은 아이콘 오른쪽 56px부터), `members`, `parents`, `sourceGroups`, `sourceEdges`(원문 줄과 정확히 같게), `edges`(`points`·`kind`·`label`·`at`), `legend`.
3. `mermaid-reference-layout.ts`의 `REFERENCE_LAYOUTS`에 등록.
4. 오른쪽 아래에 범례 상자 자리(약 250×120)를 비워 둔다. 선은 서비스 이름·설명을 지나가지 않게 아이콘 위·아래나 그룹 바깥으로 돌린다.
5. 선 종류 `kind`: `read`(파랑 굵은 실선, 열람), `runtime`(회색 실선, 요청·데이터 접근), `delivery`(초록 점선, 빌드·전달), `control`(보라 점선, 운영 반영), `reference`(회색 점선, 보조 조회).
6. 아이콘이 없으면 `architecture-icons.json`과 `mermaid-architecture.ts` 허용 목록에 함께 추가하고 출처·라이선스를 architecture.md 끝에 적는다.
