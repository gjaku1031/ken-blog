# 저장 위치와 메타데이터

모든 새 게시글은 `blog_register_post`로 DB에 제목·slug·섹션을 등록하며 상태는 처음에 `DRAFT`다. 본문 입력 필드는 없다. `content/posts/{slug}.md`를 저장소에서 직접 만든 뒤 Git에 반영한다. `blog_set_post_publication`이 공개 상태를 명시적으로 변경한다. slug와 섹션·부모 소속은 등록 후 변경하지 않는다.

## Tech

`TECH`는 기술 글이다. `categoryId`는 분류 트리 ID 또는 null, `tags`는 문자열 배열, `relatedProjectId`는 연관 프로젝트 ID 또는 null이다. 깊이 3인 소분류에서는 `techSeriesOrder`로 1 이상의 시리즈 순서를 지정할 수 있다. `summary`는 최대 120자다. 프로젝트·과목 소속 필드는 사용하지 않는다.

## Projects

`PROJECT_HOME` 등록은 프로젝트와 대문 글의 메타데이터 행을 함께 만든다. 글의 `title`이 프로젝트 이름이다. `projectMetadata`에는 `status` (`PLAN`/`DEV`/`MAINT`/`DONE`), `startPeriod`, `endPeriod`, `overview`, `stackBadgeNames`를 보낸다. 기간은 연도 또는 `YYYY.M`, `YYYY/MM`, `YYYY-MM`을 받아 `YYYY.MM`으로 정규화한다. 종료보다 늦은 시작은 거절한다. 기술 뱃지 이름은 실제 등록된 값이어야 하며 최대 30개다.

`PROJECT_DOC`는 `projectId`와 1 이상의 `documentOrder`를 가진다. 분류·태그를 지정할 수 있다. 부모 대문이 PUBLIC으로 출간된 뒤에만 공개 사이트에 나타난다. 부모 프로젝트의 기간·상태·뱃지는 관리자 웹에서 수정한다.

## Notes

`NOTE_CHAPTER`는 `courseId`와 1 이상의 `chapterOrder`를 가진다. 과목이 없으면 `blog_create_notes_course`로 먼저 만든다. 회차에는 분류·태그·프로젝트 연결을 지정하지 않는다. `summary`는 목록에 쓰인다.

## 첨부와 위키 선언

`attachment:ID` 이미지를 공개 전달하려면 해당 글의 `attachmentIds`에 READY 첨부 ID를 연결한다. 다크 이미지 ID도 포함한다. 위키 대상은 `wikiTargets`에 제목을 전체 선언한다. 등록 시 배열로 지정하거나 나중에 `blog_set_post_attachments`, `blog_set_post_wiki_targets`로 교체할 수 있다. `blog_validate_document`의 `inspection.complete=false`는 후보만 찾았다는 뜻이며 전체 선언으로 복사하지 않는다.
