---
name: ken-blog-authoring
description: Ken Blog MCP에서 Tech 글, 프로젝트 대문·문서, Notes 회차를 작성·수정하고 블록 편집기와 일치하는 Markdown 및 메타데이터를 저장할 때 사용한다.
---

# Ken Blog 작성

이 스킬은 Ken Blog MCP 도구로 원고를 만드는 에이전트용이다. 사용자 요청의 공개 범위와 게시 의도를 먼저 따른다. `blog_publish_draft`는 사용자가 출간을 요청한 경우에 실행한다. 기존 글·프로젝트·과목을 바꾸기 전에는 대상 ID와 최신 상세를 읽는다.

## 선택할 문서

- 섹션·분류·프로젝트·과목·기술 로고의 실제 저장 관계: [content-model.md](references/content-model.md)
- 저장 Markdown 전체 문법과 이미지·위키·주석·수식·도식: [markdown.md](references/markdown.md)
- 웹 편집기 입력 명령과 키보드 조작: [editor-shortcuts.md](references/editor-shortcuts.md). MCP로 원문을 직접 보낼 때는 입력 명령과 저장 문법을 구분한다.

MCP resource는 `kenblog://authoring/skill`, `kenblog://authoring/content-model`, `kenblog://authoring/markdown`, `kenblog://authoring/editor-shortcuts`에 같은 파일을 제공한다. resource를 읽지 못하는 클라이언트는 `get_authoring_guide` 도구를 사용한다.

## 안전한 작성 흐름

1. `blog_list_categories`, `blog_list_projects`, `blog_list_notes_courses`, `blog_list_stack_badges` 등으로 실제 ID와 현재 상태를 읽는다. 위키 대상의 정확한 제목이 필요하면 `blog_resolve_wiki_targets`로 한 번에 최대 20개를 확인한다. 기존 글 수정은 `blog_get_post`, 진행 중인 편집본 수정은 `blog_get_draft`로 원본·revision을 먼저 확인한다.
2. 섹션을 정하고 필요한 부모·분류·출간 속성을 채운다. `PROJECT_HOME`은 프로젝트 대문이자 프로젝트의 원본이다. `PROJECT_DOC`은 이미 출간된 프로젝트의 자식 문서, `NOTE_CHAPTER`는 과목의 회차다.
3. 본문 Markdown을 완성하고 이미지 업로드 결과의 READY 첨부 ID만 `attachment:` URL에 사용한다. `attachmentIds`와 `wikiTargets`는 본문에 실제 표시되는 참조 전체를 담은 **명시 배열**로 함께 보낸다. 코드·수식·일반 링크 주소·차단된 HTML의 가짜 참조는 제외한다. 유효한 주석 본문 안 위키 링크와 링크 표시 내용 안의 실제 이미지는 포함될 수 있다. `blog_validate_document`로 선언 배열의 형식과 확실한 본문 후보를 점검한다. 참조 이미지와 접기 내부까지 포함하는 정확한 판단이 필요하면 웹 편집기의 미리보기와 `collectAttachmentIds`·`collectWikiTargets` 동작을 기준으로 수동 확인한다. `complete=false`인 후보 목록은 전체 선언으로 자동 복사하지 않으며 `declarationsMatch=null`은 일치 판정 불가를 의미한다.
4. `blog_create_draft` 또는 `blog_update_draft`로 저장한다. 새 글의 `postId`·`baseUpdatedAt`은 둘 다 null이다. 기존 글에서 편집본을 처음 만들 때는 `blog_get_post`의 `id`·`updatedAt`을 `postId`·`baseUpdatedAt`으로 전송하고, 섹션·부모 ID·본문과 두 선언 배열을 최신 상세에 맞춘다. 편집본 갱신은 `blog_get_draft`의 최신 `revision`을 사용한다. 저장 응답을 읽어 본문·메타데이터·선언을 확인한다.
5. 사용자가 출간을 원하면 저장 응답의 최신 ID·revision으로 `blog_publish_draft`를 호출하고 반환된 글을 조회한다. 충돌 시 최신 상세를 다시 읽고 사용자의 새 내용을 덮어쓰지 않도록 병합한다.

생성·업로드 도구의 응답이 타임아웃이면 곧바로 같은 요청을 재시도하지 않는다. `blog_list_drafts`·`blog_list_stack_badges` 등으로 저장 여부를 확인한 뒤 다음 동작을 결정한다. 새 글 작성에는 멱등키가 없음.

`blog_upload_image`, `blog_create_stack_badge`, `blog_replace_stack_badge_logo`는 실제 저장을 수행한다. 파일 바이트를 준비할 수 없으면 임의의 외부 URL을 `attachment:` 주소로 가장하지 않는다. `blog_delete_draft`·배지 변경·기존 글 수정도 대상 확인 후 요청 범위에서만 실행한다.

출간 제목은 1~200 codepoint(편집본은 빈 제목 저장 가능), 본문은 UTF-8 1 MiB 이하, 첨부 ID는 최대 100개, 위키 대상은 최대 128개다. 코드블록·수식·표·접기는 가능한 원문 그대로 작성하고 미리보기에서 렌더와 링크를 확인한다.
