---
name: ken-blog-authoring
description: Ken Blog MCP에서 Tech·Projects·Notes의 원문 Markdown 편집본을 작성하고 공개 발행할 때 사용한다.
---

# Ken Blog 작성

저장소의 `content/posts/{slug}.md`가 공개 본문 원본이고 로컬 저장소가 첨부 원본이다. 메타데이터와 연결 선언은 DB에 저장된다. 미출간 글과 편집본의 Markdown은 gitignore 대상인 `content/local-posts/`, `content/local-drafts/`에 보존된다. 관리자 화면은 메타데이터만 수정한다. 공개 독자 화면은 GitHub Pages의 배포된 정적 HTML이며 API를 다시 조회하지 않는다. `blog_publish_draft`는 PUBLIC 발행만 허용하고 공개 파일을 갱신한다. 해당 파일의 커밋·push 후 Pages 배포를 확인한다. 배포가 QUEUED 또는 RUNNING인 동안 콘텐츠·첨부·메타데이터 쓰기는 잠긴다. 실패 상태라면 관리자 배포 상태를 확인하고 복구 절차를 따른다.

## 참조

- [content-model.md](references/content-model.md): Tech·Projects·Notes의 저장 필드와 숫자 순서
- [markdown.md](references/markdown.md): GFM, 위키, 주석, 코드, Mermaid, KaTeX, 접기, 이미지
- [editor-shortcuts.md](references/editor-shortcuts.md): Markdown 원문 작성과 Git 반영 절차

같은 내용은 `kenblog://authoring/skill`, `kenblog://authoring/content-model`, `kenblog://authoring/markdown`, `kenblog://authoring/editor-shortcuts` MCP resource와 `get_authoring_guide` 도구로 조회할 수 있다.

## 저장 흐름

1. 목록 도구로 실제 부모·분류·로고 ID를 확인한다. 기존 원본은 `blog_get_post`, 진행 중 편집본은 `blog_get_draft`에서 최신 원문과 revision을 읽는다. 기존 PRIVATE 출간 글은 이행 후 DRAFT로 보존되며 공개 조회에는 나타나지 않는다.
2. 본문 Markdown을 작성하고 READY 첨부의 ID를 `attachment:` 이미지 주소에 넣는다. `attachmentIds`에는 실제 표시되는 기본·다크 이미지를 모두, `wikiTargets`에는 실제 위키 대상을 넣는다. 코드·수식·일반 링크 안의 예시는 참조가 아니다. `blog_validate_document`의 `complete=false`는 후보만 찾았다는 뜻이며 전체 선언으로 복사하지 않는다.
3. `blog_create_draft` 또는 `blog_update_draft`로 비추적 편집본 Markdown을 저장한다. `visibility`는 생략하거나 `PUBLIC`만 지정한다. 기존 글 편집본은 최신 `postId`·`baseUpdatedAt`과 기존 섹션·부모를 지정한다. 수정은 최신 `revision`을 사용하고 전체 필드를 다시 보낸다.
4. 사용자가 발행을 요청했을 때만 `blog_publish_draft`를 실행한다. 발행은 원본 파일 해시도 확인하고 공개 Markdown을 갱신한다. 원본 파일이 편집 시작 후 바뀌었으면 충돌을 반환하므로 새 편집본을 만들어 병합한다. 응답의 `post`는 공개 Markdown 원본과 DB 메타데이터이며 `sourceCommitPending=true`는 아직 Pages에 반영되지 않았다는 뜻이다. 반환된 `sourcePath`를 Git에 커밋·push하고 Pages 성공을 확인한다. `CONTENT_WRITE_LOCKED` 오류를 받으면 저장 성공을 추정하지 말고 상태와 최신 편집본을 다시 조회한다. 콜백 유실은 GitHub 종료 확인이 가능한 `blog_recover_deployment`로만 복구한다. GitHub에 run이 전혀 없고 claim도 되지 않은 현재 QUEUED는 `blog_abandon_queued_deployment`로 정확한 ID만 명시 폐기할 수 있다. 충돌도 최신 상세를 읽고 원고를 병합한다.

업로드·생성 응답이 타임아웃이면 바로 재시도하지 않고 목록·상세로 저장 여부를 확인한다. 새 글에는 멱등키가 없다. `blog_delete_draft`는 편집본만 제거한다. 관리자 ZIP export는 `GET /api/v1/admin/export?all=true`로 전체 공개 원본과 로컬 저장소 첨부를 내려받는다. 미발행 원본·편집본까지 포함하려면 `includeDrafts=true`를 명시한다. `postId`, `projectId`, `courseId` 중 하나로 단일 글·프로젝트·과목을 선택할 수 있다.

제목은 출간 시 1~200 codepoint, 본문은 UTF-8 1 MiB 이하, 첨부 ID 최대 100개, 위키 대상 최대 128개. 원문·첨부 연결과 미리보기를 확인한 뒤 발행한다.
