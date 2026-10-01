# 글과 시리즈

모든 문서는 같은 Post 모델이며 본문은 `content/posts/{slug}.md`에서 관리한다. 웹 본문 편집 API는 없다.

- `blog_register_post`: title, slug, summary(120자), categoryId, tags, seriesId, order, relatedSeriesId, attachmentIds, wikiTargets.
- `seriesId` 생략 시 일반 독립 글. `blog_create_series`의 kind는 TECH(일반) 또는 PROJECT이며 metadata에 name과 description 지정.
- PROJECT에만 projectStatus(PLAN/DEV/MAINT/DONE), startPeriod(YYYY.MM), endPeriod, stackBadgeNames 허용.
- 문서 order는 양수 또는 null. 순서→출간 시각→ID로 정렬하며 번호가 없는 글은 마지막. 첫 공개 글이 시리즈 대문.
- 시리즈와 소분류는 별개. 시리즈가 있으면 우선 사용하며, 없으면 깊이 3 소분류 문서 목록을 사용.
- `blog_set_post_series`로 소속·순서·관련 프로젝트를 변경. relatedSeriesId는 PROJECT 시리즈만 지정.
- `blog_update_series`에는 조회한 updatedAt을 baseUpdatedAt으로 전달.
- Home에는 전체 최근 글, Posts에는 일반 글, Projects에는 프로젝트 묶음 표시. 공통 글 주소는 `/post/{slug}/`.
- 출간/철회는 `blog_set_post_publication`으로 명시적으로 변경. 원고가 없으면 Pages 생성 실패.
- 기존 원고·ID·slug·미출간 자료는 보존. 시리즈 삭제는 연결된 글이 없을 때만 허용.
