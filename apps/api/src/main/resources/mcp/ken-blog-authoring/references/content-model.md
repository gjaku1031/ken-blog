# 저장 위치와 메타데이터

## Tech

`TECH`는 시간순 기술 글 피드. `categoryId`는 분류 트리 ID 또는 null, `tags`는 문자열 배열, `relatedProjectId`는 연관된 **출간 프로젝트** ID 또는 null. 깊이 3인 Tech 소분류에서만 `techSeriesOrder`로 1 이상의 시리즈 순서 사용. `projectId`·`courseId`·`projectMetadata`는 사용하지 않음. 목록 요약 `summary`는 최대 120자; 빈 값이면 출간 시 본문에서 추출. `visibility`는 `PUBLIC` 또는 `PRIVATE`.

## Projects

`PROJECT_HOME` 편집본 출간이 프로젝트를 만듦. 글 `title`이 프로젝트 이름. MCP 입력 `projectMetadata`에는 `status` (`PLAN`/`DEV`/`MAINT`/`DONE`), `startPeriod`, `endPeriod`, `overview`, `baseProjectUpdatedAt`, `stackBadgeNames`를 전송. 공개 범위는 편집본 최상위 `visibility` 한 곳에 지정하고 프로젝트 메타데이터로도 같은 값이 저장됨. 기간은 연도 또는 `YYYY.M`, `YYYY/MM`, `YYYY-MM`을 받아 `YYYY.MM`으로 정규화; 종료보다 늦은 시작은 거절. `overview`는 500 codepoint 이하, 선택 로고 이름은 최대 30개·중복 불가. `baseProjectUpdatedAt`은 기존 프로젝트 대문 수정의 충돌 검사용이며 새 프로젝트에서는 null.

기술 스택은 프로젝트 메타의 `stackBadgeNames` 배열 순서로 연결하며, 이름은 등록된 배지와 정확히 일치해야 함. `blog_list_stack_badges`로 확인. 없는 로고는 사용자 제공 이미지 바이트로 `blog_create_stack_badge`에 이름과 `image` 입력을 올린 뒤 사용. `image`는 `filename`, `mimeType` (`image/png`/`image/jpeg`), 순수 `base64` 바이트로 구성; 서버 경로나 이미지 URL을 입력으로 받지 않음. 등록 로고 교체는 `blog_replace_stack_badge_logo`, 이름 변경은 `blog_rename_stack_badge`. 이미지 파일은 서버에서 64×64 PNG로 정규화되어 OCI에 저장되고 공개 배지 URL로 제공됨. 이름 변경은 프로젝트 ID 연결을 유지.

`PROJECT_DOC`는 **출간된** 대문 아래 문서. `projectId`에 프로젝트 ID, `documentOrder`에 1 이상 순서. Tech처럼 분류·태그를 지정할 수 있지만 `relatedProjectId`·`projectMetadata`는 사용하지 않음. 부모 프로젝트의 공개 범위도 독자 접근에 영향. 기존 문서를 다른 프로젝트로 옮기지 않음.

## Notes

`NOTE_CHAPTER`는 과목 안의 회차. `blog_list_notes_courses` 또는 `blog_get_notes_course`로 분야(`field`)와 과목 ID를 확인. 과목이 없으면 `blog_create_notes_course`에 `field`, `name`, `description`, `status` (`IN_PROGRESS`/`COMPLETED`) 입력. 글은 `courseId`와 1 이상의 `chapterOrder`를 가짐. 태그·분류·프로젝트 연결은 없음. 기존 회차의 과목 이동 불가. `summary`는 목록에 쓰임.

## 공통 편집본

`blog_create_draft`는 새 글에 `postId=null`, `baseUpdatedAt=null`; 기존 원본 편집에 원본 `id`·`updatedAt` 사용. 원본 편집본은 하나만 허용. `blog_update_draft`는 현재 `revision`을 기대하고 모든 저장 필드를 교체하므로 읽은 상세의 미수정 필드도 보존해 전송. 섹션과 프로젝트·과목 소속은 저장 후 변경할 수 없음. `attachmentIds`·`wikiTargets`는 매번 명시해 현재 본문에 맞게 전체 교체. 생략·null은 기존 연결 상속/유지 등 다른 의미이므로 MCP 작성에서는 사용하지 않음. `blog_publish_draft`는 같은 revision에서 원자적으로 출간하고 편집본을 제거.

도구 입력의 바깥 구조: `blog_create_draft`는 `{ "input": { …전체 필드… } }`, `blog_update_draft`는 `{ "draftId": 12, "input": { "revision": 3, "content": { …전체 필드… } } }`. `blog_publish_draft`는 `draftId`와 최신 `revision`. `blog_validate_document`는 `body`, `attachmentIds`, `wikiTargets`를 각각 받으며 `declarationDiagnostics`에서 배열 형식, `inspection.diagnostics`에서 보수적 본문 분석 한계를 확인. `inspection.complete=false`인 경우 `declarationsMatch=null`은 일치 판정 불가.

`blog_list_posts`, `blog_search_posts`, `blog_get_post`, `blog_list_drafts`, `blog_get_draft`는 대상 확인용. `blog_list_categories`는 실제 category ID를, `blog_list_projects`/`blog_get_project`는 실제 프로젝트 ID와 대문 출간 상태를 확인하는 데 사용.
