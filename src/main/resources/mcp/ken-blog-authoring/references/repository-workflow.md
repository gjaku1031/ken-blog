# 저장소 Markdown 작성

새 글은 `blog_register_post`가 돌려준 `content/posts/{slug}.md`에 UTF-8 Markdown을 직접 작성한다. `DRAFT` 상태여도 같은 경로를 사용한다. 기존 미출간 원고가 `content/local-posts/`에 있으면 자동 이동하지 않으므로 내용을 확인한 뒤 공개 경로에 직접 옮긴다.

할 일 상태는 `- [ ]` 또는 `- [x]` 원문을 직접 고친다. GFM 표는 머리글 다음에 `| --- |` 구분 행을 쓴다. 코드·Mermaid는 닫는 fence까지 작성한다. 접기는 `<details><summary>…</summary>…</details>` 원문을 유지한다. 내부 이미지는 `![설명|dark=53|w=75|a=center](attachment:52)`처럼 쓰고 두 이미지 ID를 DB 첨부 선언에 연결한다.

변경한 파일을 Git에 커밋해 `main`에 push하면 Pages Actions가 자동 실행되어 해당 checkout의 Markdown을 사용한다. 출간 메타데이터는 `blog_set_post_publication`에서 별도로 변경한다. 출간·제목·태그·첨부 연결 등 DB 메타데이터만 변경했거나 `main` push가 끝난 뒤 상태를 바꿨다면 GitHub에서 Pages Actions를 수동 실행해야 새 snapshot이 사이트에 반영된다. 파일 누락, 잘못된 UTF-8, 1 MiB 초과는 읽기 또는 빌드 실패로 확인한다.
