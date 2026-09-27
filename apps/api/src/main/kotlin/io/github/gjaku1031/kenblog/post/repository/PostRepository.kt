package io.github.gjaku1031.kenblog.post.repository

import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.PrivatePostLockRow
import io.github.gjaku1031.kenblog.post.dto.AdminPostRow
import io.github.gjaku1031.kenblog.post.dto.PublicPostCacheRow
import io.github.gjaku1031.kenblog.post.dto.PublishedPostRow
import io.github.gjaku1031.kenblog.post.dto.WikiLinkTargetRow
import io.github.gjaku1031.kenblog.post.dto.WikiNavigationRow
import io.github.gjaku1031.kenblog.post.dto.RelatedProjectResponse
import io.github.gjaku1031.kenblog.post.dto.PostViewAccessRow
import io.github.gjaku1031.kenblog.post.dto.PostSeriesRow
import io.github.gjaku1031.kenblog.post.service.PostService
import io.github.gjaku1031.kenblog.category.dto.CategoryPostCountRow
import jakarta.persistence.LockModeType
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** 위키 조회에서 프로젝트 글의 연결된 대문이 현재 출간 중인지 본문 없이 확인하는 조건. */
private const val PUBLISHED_PROJECT_PARENT =
    "(p.section in ('TECH', 'NOTE_CHAPTER') or (project.id is not null and home.id is not null " +
        "and home.section = 'PROJECT_HOME' and home.project_id = project.id " +
        "and home.status = 'PUBLISHED' and (p.section <> 'PROJECT_HOME' or p.id = home.id)))"

/** 대표 제목 선출에서 더 앞선 후보에도 동일한 부모 출간 조건을 적용. */
private const val PUBLISHED_OLDER_PROJECT_PARENT =
    "(older.section in ('TECH', 'NOTE_CHAPTER') or (older_project.id is not null and older_home.id is not null " +
        "and older_home.section = 'PROJECT_HOME' and older_home.project_id = older_project.id " +
        "and older_home.status = 'PUBLISHED' " +
        "and (older.section <> 'PROJECT_HOME' or older.id = older_home.id)))"

/**
 * [PostEntity]의 기본 저장·ID 조회를 [JpaRepository]에 맡기는 게시글 저장소.
 *
 * [PostService.createDraft]는 새 엔티티의 null ID를 유지한 채
 * [JpaRepository.saveAndFlush]를 호출하여 제약 오류를 트랜잭션 안에서 확인함.
 * ID 조회는 [JpaRepository.findById]를 사용함.
 */
interface PostRepository : JpaRepository<PostEntity, Long> {
    /** @return [PostSeriesRow]를 빈 번호 먼저, 저장 번호·최초 출간일·ID 순서로 조회. */
    @Query("select new io.github.gjaku1031.kenblog.post.dto.PostSeriesRow(p.id, p.slug, p.title) " +
        "from PostEntity p where p.section = :tech and p.categoryId = :categoryId " +
        "and p.status = :published and (:includePrivate = true or p.visibility = :publicVisibility) " +
        "order by case when p.techSeriesOrder is null then 0 else 1 end asc, " +
        "p.techSeriesOrder asc, p.publishedAt asc, p.id asc")
    fun findTechSeries(@Param("categoryId") categoryId: Long, @Param("tech") tech: PostSection,
        @Param("published") published: PostStatus, @Param("includePrivate") includePrivate: Boolean,
        @Param("publicVisibility") publicVisibility: PostVisibility): List<PostSeriesRow>
    /** @return 조회 집계에서 본문 없이 글·부모 출간과 공개 범위를 확인할 행. */
    @Query("select new io.github.gjaku1031.kenblog.post.dto.PostViewAccessRow(" +
        "p.id, p.status, p.visibility, p.section, project.id, project.visibility, " +
        "home.visibility, home.status, home.section, home.id, home.projectId) " +
        "from PostEntity p left join ProjectEntity project on project.id = p.projectId " +
        "left join PostEntity home on home.id = project.homePostId where p.id = :id")
    fun findViewAccess(@Param("id") id: Long): PostViewAccessRow?

    /** @return 현재 글의 저장된 조회 수. */
    @Query("select p.viewCount from PostEntity p where p.id = :id")
    fun findViewCount(@Param("id") id: Long): Long?

    /** @return 원자적으로 조회 수를 하나 올린 행 수. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PostEntity p set p.viewCount = p.viewCount + 1 where p.id = :id")
    fun incrementViewCount(@Param("id") id: Long): Int
    /** @return 현재 핀의 ID를 순서대로 가져오되 본문 열을 읽지 않음. */
    @Query("select p.id from PostEntity p where p.pinOrder is not null order by p.pinOrder asc, p.id asc")
    fun findPinnedIds(): List<Long>
    /**
     * 저장된 slug와 정확히 일치하는 게시글을 파생 쿼리로 조회.
     *
     * @param slug 정규화된 소문자 ASCII slug
     * @return 일치하는 [PostEntity], 없으면 `null`
     */
    fun findBySlug(slug: String): PostEntity?

    /**
     * 관리자 내용 PUT·삭제와 출간 상태 전환을 같은 행 잠금으로 직렬화.
     *
     * @param id 게시글 식별자
     * @return 잠근 [PostEntity], 없으면 `null`
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PostEntity p where p.id = :id")
    fun findLockedById(@Param("id") id: Long): PostEntity?

    /**
     * 본문 열을 읽지 않고 관리자 초안·출간 목록의 한 페이지를 생성자 DTO로 조회.
     *
     * @param pageable 검증된 0 기반 페이지와 크기; 정렬은 쿼리에 고정됨
     * @return 생성 시각·ID 내림차순의 [AdminPostRow] 페이지
     */
    @Query(
        value = "select new io.github.gjaku1031.kenblog.post.dto.AdminPostRow(p.id, p.title, p.slug, p.createdAt, p.updatedAt, p.status, p.visibility, p.publishedAt, p.categoryId, p.section, p.projectId, p.courseId, p.summary, p.pinOrder, p.viewCount, p.techSeriesOrder, coalesce(project.name, related.name), course.name, course.field, p.documentOrder, p.chapterOrder) " +
            "from PostEntity p left join ProjectEntity project on project.id = p.projectId " +
            "left join ProjectEntity related on related.id = p.relatedProjectId " +
            "left join CourseEntity course on course.id = p.courseId " +
            "order by p.createdAt desc, p.id desc",
        countQuery = "select count(p) from PostEntity p",
    )
    fun findAdminSummaries(pageable: Pageable): Page<AdminPostRow>

    /**
     * 본문 열 없이 출간 글을 권한별로 필터하고 같은 조건으로 전체 건수를 조회.
     *
     * @param published 출간 상태
     * @param publicVisibility 익명에게 노출할 범위
     * @param includePrivate ADMIN 권한이 있는지 여부
     * @param categoryPath 분류 필터의 정규화된 전체 경로, 없으면 `null`
     * @param descendantPath 하위 경로까지 포함하는 LIKE 패턴, 필터가 없으면 `null`
     * @param tag 정확히 일치할 정규화 태그, 없으면 `null`
     * @param pageable 검증된 페이지와 크기
     * @return 최초 출간 시각·ID 내림차순의 [PublishedPostRow] 페이지
     */
    @Query(
        value = "select new io.github.gjaku1031.kenblog.post.dto.PublishedPostRow(p.id, p.title, p.slug, p.publishedAt, p.categoryId) " +
            "from PostEntity p where p.section = io.github.gjaku1031.kenblog.post.domain.PostSection.TECH " +
            "and p.status = :published and (:includePrivate = true or p.visibility = :publicVisibility) " +
            "and (:categoryPath is null or exists (select c.id from CategoryEntity c where c.id = p.categoryId " +
            "and (c.path = :categoryPath or c.path like :descendantPath))) " +
            "and (:tag is null or exists (select t.id from PostTagEntity t where t.postId = p.id and t.name = :tag)) " +
        "order by case when :seriesOrder = true and p.techSeriesOrder is null then 0 " +
            "when :seriesOrder = true then 1 else null end asc, " +
            "case when :seriesOrder = true then p.techSeriesOrder else null end asc, " +
            "case when :seriesOrder = true then p.publishedAt else null end asc, " +
            "case when :seriesOrder = true then p.id else null end asc, " +
            "case when :seriesOrder = false then p.publishedAt else null end desc, " +
            "case when :seriesOrder = false then p.id else null end desc",
        countQuery = "select count(p) from PostEntity p " +
            "where p.section = io.github.gjaku1031.kenblog.post.domain.PostSection.TECH and p.status = :published " +
            "and (:includePrivate = true or p.visibility = :publicVisibility) " +
            "and (:categoryPath is null or exists (select c.id from CategoryEntity c where c.id = p.categoryId " +
            "and (c.path = :categoryPath or c.path like :descendantPath))) " +
            "and (:tag is null or exists (select t.id from PostTagEntity t where t.postId = p.id and t.name = :tag))",
    )
    fun findPublishedSummaries(
        @Param("published") published: PostStatus,
        @Param("publicVisibility") publicVisibility: PostVisibility,
        @Param("includePrivate") includePrivate: Boolean,
        @Param("seriesOrder") seriesOrder: Boolean,
        @Param("categoryPath") categoryPath: String?,
        @Param("descendantPath") descendantPath: String?,
        @Param("tag") tag: String?,
        pageable: Pageable,
    ): Page<PublishedPostRow>

    /**
     * 권한 있는 열람자의 출간 글을 slug로 조회.
     *
     * @param slug 정규화된 주소
     * @param status 출간 상태
     * @return 본문 포함 [PostEntity], 없으면 `null`
     */
    @Query("select p from PostEntity p where p.slug = :slug and p.status = :status " +
        "and (p.section in (:tech, :note) or exists (select project.id from ProjectEntity project, PostEntity home " +
        "where project.id = p.projectId and home.id = project.homePostId and home.projectId = project.id " +
        "and home.section = :homeSection and home.status = :status " +
        "and (p.section <> :homeSection or p.id = home.id)))")
    fun findBySlugAndStatus(@Param("slug") slug: String, @Param("status") status: PostStatus,
        @Param("tech") tech: PostSection, @Param("note") note: PostSection,
        @Param("homeSection") homeSection: PostSection): PostEntity?

    /**
     * 익명 열람자가 본문을 읽어도 되는 출간 글만 조회.
     *
     * @param slug 정규화된 주소
     * @param status 출간 상태
     * @param visibility 공개 범위
     * @return 본문 포함 [PostEntity], 없으면 `null`
     */
    @Query("select p from PostEntity p where p.slug = :slug and p.status = :status and p.visibility = :visibility " +
        "and (p.section in (:tech, :note) or exists (select project.id from ProjectEntity project, PostEntity home " +
        "where project.id = p.projectId and project.visibility = :visibility and home.id = project.homePostId " +
        "and home.projectId = project.id and home.section = :homeSection and home.status = :status " +
        "and home.visibility = :visibility and (p.section <> :homeSection or p.id = home.id)))")
    fun findBySlugAndStatusAndVisibility(@Param("slug") slug: String, @Param("status") status: PostStatus,
        @Param("visibility") visibility: PostVisibility, @Param("tech") tech: PostSection,
        @Param("note") note: PostSection,
        @Param("homeSection") homeSection: PostSection): PostEntity?

    /**
     * 익명 PUBLIC 상세에서 캐시보다 먼저 현재 공개 범위·해시를 본문 열 없이 조회.
     *
     * @param slug 정규화된 주소
     * @param status 출간 상태
     * @param visibility 공개 범위
     * @return 현재 공개 글의 [PublicPostCacheRow], 없으면 `null`
     */
    @Query("select new io.github.gjaku1031.kenblog.post.dto.PublicPostCacheRow(p.id, p.title, p.slug, p.publishedAt, p.bodySha256, p.categoryId, p.relatedProjectId, p.summary, p.pinOrder, p.viewCount, p.techSeriesOrder) " +
        "from PostEntity p where p.slug = :slug and p.section = :tech and p.status = :status and p.visibility = :visibility")
    fun findPublicCacheMetadataBySlug(
        @Param("slug") slug: String,
        @Param("status") status: PostStatus,
        @Param("visibility") visibility: PostVisibility,
        @Param("tech") tech: PostSection,
    ): PublicPostCacheRow?

    /**
     * 비관리자의 PRIVATE 직접 진입에 허용된 최소 열만 선택하고 본문 열을 읽지 않음.
     *
     * @param slug 정규화된 주소
     * @param status 출간 상태
     * @param visibility 비공개 범위
     * @return 잠금 화면용 [PrivatePostLockRow], 없으면 `null`
     */
    @Query("select new io.github.gjaku1031.kenblog.post.dto.PrivatePostLockRow(" +
        "p.id, p.title, p.slug, p.publishedAt, p.section, project.slug, course.slug) " +
        "from PostEntity p left join ProjectEntity project on project.id = p.projectId " +
        "left join CourseEntity course on course.id = p.courseId " +
        "where p.slug = :slug and p.status = :status and p.visibility = :visibility " +
        "and (p.section in (:tech, :note) or exists (select home.id from PostEntity home " +
        "where home.id = project.homePostId and home.projectId = project.id " +
        "and home.section = :homeSection and home.status = :status and home.visibility = :publicVisibility " +
        "and project.visibility = :publicVisibility and (p.section <> :homeSection or p.id = home.id)))")
    fun findPrivateLockBySlug(
        @Param("slug") slug: String,
        @Param("status") status: PostStatus,
        @Param("visibility") visibility: PostVisibility,
        @Param("publicVisibility") publicVisibility: PostVisibility,
        @Param("tech") tech: PostSection,
        @Param("note") note: PostSection,
        @Param("homeSection") homeSection: PostSection,
    ): PrivatePostLockRow?

    /** @return 출간된 대문과 현재 권한에서 읽을 수 있는 프로젝트의 최소 이동 정보. */
    @Query("select new io.github.gjaku1031.kenblog.post.dto.RelatedProjectResponse(" +
        "project.id, project.slug, project.name) from ProjectEntity project, PostEntity home " +
        "where project.id = :projectId and home.id = project.homePostId and home.projectId = project.id " +
        "and home.section = :homeSection and home.status = :published " +
        "and (:includePrivate = true or (project.visibility = :publicVisibility and home.visibility = :publicVisibility))")
    fun findReadableProject(@Param("projectId") projectId: Long, @Param("homeSection") homeSection: PostSection,
        @Param("published") published: PostStatus, @Param("publicVisibility") publicVisibility: PostVisibility,
        @Param("includePrivate") includePrivate: Boolean): RelatedProjectResponse?

    /**
     * SQL LOWER 뒤 이진 비교로 악센트를 구별하며 출간 글의 최초 후보 한 건만 조회.
     *
     * 같은 제목은 최초 출간 시각·ID 오름차순으로 결정함. 본문 열은 선택하지 않음.
     *
     * @param title 공백·길이 검증을 마친 요청 제목
     * @return 이동·권한 판별에 필요한 [WikiLinkTargetRow], 없으면 `null`
     */
    @Query(
        value = "select p.id as id, p.title as title, p.slug as slug, p.visibility as visibility, " +
            "p.section as section, project.slug as projectSlug, course.slug as courseSlug, project.visibility as projectVisibility, " +
            "home.visibility as homeVisibility " +
            "from posts p left join projects project on project.id = p.project_id " +
            "left join courses course on course.id = p.course_id " +
            "left join posts home on home.id = project.home_post_id where p.status = 'PUBLISHED' " +
            "and " + PUBLISHED_PROJECT_PARENT + " " +
            "and cast(lower(p.title) as binary) = cast(lower(:title) as binary) " +
            "order by case when p.section = 'PROJECT_HOME' then 1 else 0 end asc, " +
            "p.published_at asc, p.id asc limit 1",
        nativeQuery = true,
    )
    fun findWikiLinkTarget(@Param("title") title: String): WikiLinkTargetRow?

    /** @return slug로 찾은 출간 대상의 본문 없는 현재 최소 메타데이터. */
    @Query(value = "select p.id as id, p.title as title, p.slug as slug, p.visibility as visibility, " +
        "p.section as section, project.slug as projectSlug, course.slug as courseSlug, project.visibility as projectVisibility, " +
        "home.visibility as homeVisibility " +
        "from posts p left join projects project on project.id = p.project_id " +
        "left join courses course on course.id = p.course_id " +
        "left join posts home on home.id = project.home_post_id " +
        "where p.slug = :slug and p.status = 'PUBLISHED' and " + PUBLISHED_PROJECT_PARENT, nativeQuery = true)
    fun findPublishedWikiTargetBySlug(@Param("slug") slug: String): WikiLinkTargetRow?

    /**
     * 검색어를 SQL 와일드카드로 해석하지 않고 본문 없는 대표 제목만 최대 7개 반환.
     * 동일 제목의 대표는 위키 resolve와 같은 최초 출간 시각·ID 순서임.
     */
    @Query(value = "select p.id as id, p.title as title, p.slug as slug, p.section as section, " +
        "project.slug as projectSlug, course.slug as courseSlug, " +
        "project.name as projectName, course.name as courseName from posts p " +
        "left join projects project on project.id = p.project_id " +
        "left join courses course on course.id = p.course_id " +
        "left join posts home on home.id = project.home_post_id " +
        "where p.status = 'PUBLISHED' and " + PUBLISHED_PROJECT_PARENT + " " +
        "and locate(cast(lower(:query) as binary), cast(lower(p.title) as binary)) > 0 " +
        "and not exists (select 1 from posts older " +
        "left join projects older_project on older_project.id = older.project_id " +
        "left join posts older_home on older_home.id = older_project.home_post_id " +
        "where older.status = 'PUBLISHED' and " + PUBLISHED_OLDER_PROJECT_PARENT + " " +
        "and cast(lower(older.title) as binary) = cast(lower(p.title) as binary) " +
        "and (case when older.section = 'PROJECT_HOME' then 1 else 0 end " +
        "< case when p.section = 'PROJECT_HOME' then 1 else 0 end " +
        "or (case when older.section = 'PROJECT_HOME' then 1 else 0 end " +
        "= case when p.section = 'PROJECT_HOME' then 1 else 0 end " +
        "and (older.published_at < p.published_at " +
        "or (older.published_at = p.published_at and older.id < p.id))))) " +
        "order by p.published_at desc, p.id desc limit 7", nativeQuery = true)
    fun searchCanonicalTitles(@Param("query") query: String): List<WikiNavigationRow>

    /**
     * SQL 출간·가시성 필터 뒤 명시적 참조만 조회; 본문·초안 열을 읽지 않음.
     * 페이지마다 11개를 읽어 마지막 하나로 다음 페이지 여부만 판단함.
     */
    @Query(value = "select p.id as id, p.title as title, p.slug as slug, p.section as section, " +
        "project.slug as projectSlug, course.slug as courseSlug, " +
        "project.name as projectName, course.name as courseName from posts p " +
        "left join projects project on project.id = p.project_id " +
        "left join courses course on course.id = p.course_id " +
        "left join posts home on home.id = project.home_post_id " +
        "where p.status = 'PUBLISHED' and p.id <> :targetId and (:includePrivate = true or p.visibility = 'PUBLIC') " +
        "and " + PUBLISHED_PROJECT_PARENT + " " +
        "and (:includePrivate = true or p.section in ('TECH', 'NOTE_CHAPTER') " +
        "or (project.visibility = 'PUBLIC' and home.visibility = 'PUBLIC')) " +
        "and exists (select 1 from post_wiki_links w where w.post_id = p.id " +
        "and cast(lower(w.target_title) as binary) = cast(lower(:targetTitle) as binary)) " +
        "order by p.published_at desc, p.id desc limit 11 offset :offset", nativeQuery = true)
    fun findBacklinkRows(
        @Param("targetId") targetId: Long,
        @Param("targetTitle") targetTitle: String,
        @Param("includePrivate") includePrivate: Boolean,
        @Param("offset") offset: Int,
    ): List<WikiNavigationRow>

    /** @return PROJECT_DOC의 출간 대문·공개 범위를 확인해 분류별 [CategoryPostCountRow]를 집계. */
    @Query("select new io.github.gjaku1031.kenblog.category.dto.CategoryPostCountRow(p.categoryId, count(p)) " +
        "from PostEntity p left join ProjectEntity project on project.id = p.projectId " +
        "left join PostEntity home on home.id = project.homePostId " +
        "where p.section in (io.github.gjaku1031.kenblog.post.domain.PostSection.TECH, " +
        "io.github.gjaku1031.kenblog.post.domain.PostSection.PROJECT_DOC) " +
        "and p.categoryId is not null and (:admin = true or " +
        "(p.status = :published and (p.section = io.github.gjaku1031.kenblog.post.domain.PostSection.TECH or " +
        "(home.status = :published and home.section = io.github.gjaku1031.kenblog.post.domain.PostSection.PROJECT_HOME " +
        "and home.projectId = project.id)) and (:includePrivate = true or " +
        "(p.visibility = :publicVisibility and (p.section = io.github.gjaku1031.kenblog.post.domain.PostSection.TECH " +
        "or (project.visibility = :publicVisibility and home.visibility = :publicVisibility)))))) " +
        "group by p.categoryId")
    fun countByCategoryForRole(
        @Param("admin") admin: Boolean,
        @Param("published") published: PostStatus,
        @Param("publicVisibility") publicVisibility: PostVisibility,
        @Param("includePrivate") includePrivate: Boolean,
    ): List<CategoryPostCountRow>

    /** @return 잠긴 분류 하위의 글을 삭제 대상의 부모로 한 SQL에서 옮긴 수. */
    @Modifying(flushAutomatically = true)
    @Query("update PostEntity p set p.categoryId = :parentId, p.techSeriesOrder = null where p.categoryId in :categoryIds")
    fun moveCategories(@Param("categoryIds") categoryIds: Collection<Long>, @Param("parentId") parentId: Long?): Int
}
