# CodeMirror 원문 편집

관리자 `/manage/`의 왼쪽 입력은 Markdown 원문이고 오른쪽은 자동 갱신 미리보기다. 왼쪽 스크롤을 기준으로 오른쪽 문서가 따라간다. 표·이미지·접기·Mermaid·KaTeX·주석도 저장 값은 입력한 원문이다. 블록 삽입 명령이나 드래그 정렬, 읽기 체크박스 즉시 저장은 없다.

할 일 상태는 `- [ ]` 또는 `- [x]` 원문을 직접 고쳐 저장한다. GFM 표는 머리글 다음에 `| --- |` 구분 행을 쓴다. 코드·Mermaid는 닫는 fence까지 작성한다. 접기는 기존 `<details><summary>…</summary>…</details>` 원문을 유지한다. 내부 이미지는 `![설명|dark=53|w=75|a=center](attachment:52)`처럼 쓴다. 다크 이미지 ID도 `attachmentIds`에 포함한다.

MCP의 `body`에는 화면 조작 명령이 아니라 완성된 Markdown 원문을 보낸다. `/표` 같은 문자열은 자동 표로 바뀌지 않는다. 발행 후 정적 Pages 배포가 끝날 때까지 콘텐츠 쓰기가 잠기므로 배포 상태와 최신 revision을 확인한다.
