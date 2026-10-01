---
name: ken-blog-authoring
description: Ken Blog의 일반 글·프로젝트 원고를 저장소 Markdown으로 작성하고 DB 메타데이터를 연결할 때 사용한다.
---

# Ken Blog 작성

`content/posts/{slug}.md`가 새 글과 공개 글의 본문 원본이다. 본문은 저장소의 코드 또는 GitHub에서 직접 작성·수정하고 Git에 커밋한다. MCP와 관리자 웹은 본문을 저장하지 않으며 제목·소속·기간·태그·첨부 및 위키 대상 같은 DB 메타데이터만 관리한다. Pages 빌드는 Git checkout의 Markdown을 읽고 서버 snapshot의 공개 메타데이터와 결합한다.

기존 미출간·PRIVATE 원고는 `content/local-posts/`에 남아 있을 수 있다. 이를 자동으로 공개하거나 이동하지 않는다. 기존 DB의 원고 호환 열과 옛 편집본은 운영 이관 전 별도 추출 대상이다.

## 참조

- [content-model.md](references/content-model.md): 시리즈 소속과 메타데이터
- [markdown.md](references/markdown.md): GFM, 위키, 주석, 코드, Mermaid, KaTeX, 접기, 이미지
- [repository-workflow.md](references/repository-workflow.md): 파일 작성·Git 반영 순서

같은 내용은 `kenblog://authoring/skill`, `kenblog://authoring/content-model`, `kenblog://authoring/markdown`, `kenblog://authoring/repository-workflow` MCP resource와 `get_authoring_guide` 도구로 조회할 수 있다.

## 작성 순서

1. `blog_list_posts`, `blog_list_categories`, `blog_list_series` 등으로 기존 글과 부모 ID를 확인한다.
2. 새 글은 `blog_register_post`에 제목, 명시적 slug, 시리즈 소속과 메타데이터만 보낸다. 반환된 `sourcePath`에 UTF-8 Markdown 파일을 작성한다. 기존 글은 `blog_get_post`로 메타데이터와 현재 원고를 확인한다. 서버에 파일이 없으면 원본 경로를 포함한 404를 반환하므로 저장소 파일을 확인한다.
3. `attachment:ID` 이미지를 사용하면 READY 첨부 ID 전체를 `blog_set_post_attachments`에 연결한다. 위키 대상은 `blog_validate_document`로 확인하고 `blog_set_post_wiki_targets`에 현재 원고 SHA-256과 제목 전체를 보낸다. 복잡한 Markdown은 검사가 완전하지 않을 수 있으므로 실제 원고를 확인한다.
4. 원고 파일을 Git에 커밋해 `main`에 push한다. 이 push가 Pages Actions를 자동 실행한다. 공개할 때 `blog_set_post_publication(published=true)`로 DB 상태를 바꾼다. 출간 상태 등 DB 메타데이터를 push 후 변경했다면 GitHub의 Pages Actions를 수동 실행해 새 snapshot을 반영한다. Actions는 snapshot과 Git 원고를 결합해 정적 HTML을 만든다. 파일이 없으면 빌드가 실패하므로 먼저 파일을 반영한다.

기존 PRIVATE 또는 `local-posts` 원고를 공개하려면 내용을 검토하고 `content/posts/{slug}.md`로 명시적으로 옮긴 뒤 상태를 변경한다. 기존 DB 원고와 옛 편집본 데이터는 운영 이관 전에 `ops/export-markdown.py`로 일회성 추출해 보존한다.
