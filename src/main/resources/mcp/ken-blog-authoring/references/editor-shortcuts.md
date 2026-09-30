# Markdown 원문 작성

본문은 저장소의 `content/posts/{slug}.md` 파일로 공개된다. MCP 편집본은 비추적 `content/local-drafts/`에 저장되고, 발행 시 공개 파일을 갱신한다. 관리자 화면은 제목·요약·분류·태그 같은 메타데이터를 수정한다.

할 일 상태는 `- [ ]` 또는 `- [x]` 원문을 직접 고쳐 저장한다. GFM 표는 머리글 다음에 `| --- |` 구분 행을 쓴다. 코드·Mermaid는 닫는 fence까지 작성한다. 접기는 기존 `<details><summary>…</summary>…</details>` 원문을 유지한다. 내부 이미지는 `![설명|dark=53|w=75|a=center](attachment:52)`처럼 쓴다. 다크 이미지 ID도 `attachmentIds`에 포함한다.

MCP의 `body`에는 완성된 Markdown 원문을 보낸다. `/표` 같은 문자열은 자동 표로 바뀌지 않는다. 발행 응답의 `sourceCommitPending=true`를 확인하고 파일을 커밋·push한 후 Pages 결과를 확인한다.
