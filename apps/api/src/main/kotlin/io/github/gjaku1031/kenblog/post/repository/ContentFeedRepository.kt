package io.github.gjaku1031.kenblog.post.repository

import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.ContentFeedRow
import java.time.LocalDateTime
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** Home·Tech·Notes의 본문 없는 최신/핀 페이지와 전체 검색을 조회. */
interface ContentFeedRepository : JpaRepository<PostEntity, Long> {
    /** @return 현재 역할의 Home 출간 시각만 본문 없이 선택. */
    @Query("select p.publishedAt from PostEntity p " +
        "left join ProjectEntity project on project.id = p.projectId " +
        "left join PostEntity home on home.id = project.homePostId " +
        "where p.status = :published and (p.section = :tech or p.section = :note or " +
        "(p.section = :projectDoc and project.id is not null and home.status = :published " +
        "and home.section = :homeSection and home.projectId = project.id)) " +
        "and (:includePrivate = true or (p.visibility = :publicVisibility and " +
        "(project.id is null or (project.visibility = :publicVisibility and home.visibility = :publicVisibility)))) " +
        "and p.publishedAt >= :from")
    fun activityDates(@Param("published") published: PostStatus, @Param("tech") tech: PostSection,
        @Param("note") note: PostSection, @Param("projectDoc") projectDoc: PostSection,
        @Param("homeSection") homeSection: PostSection,
        @Param("includePrivate") includePrivate: Boolean,
        @Param("publicVisibility") publicVisibility: PostVisibility,
        @Param("from") from: LocalDateTime): List<LocalDateTime>
    /** @return [ContentFeedRow]의 Tech/Notes와 출간 대문 소속 PROJECT_DOC 최신 또는 핀 페이지. */
    @Query(value = "select new io.github.gjaku1031.kenblog.post.dto.ContentFeedRow(" +
        "p.id, p.title, p.slug, p.section, p.summary, p.publishedAt, p.visibility, p.categoryId, " +
        "coalesce(project.slug, case when :includePrivate = true or (related.visibility = :publicVisibility and " +
        "relatedHome.status = :published and relatedHome.section = :homeSection and " +
        "relatedHome.projectId = related.id and relatedHome.visibility = :publicVisibility) then related.slug else null end), " +
        "course.slug, coalesce(project.name, case when :includePrivate = true or (related.visibility = :publicVisibility and " +
        "relatedHome.status = :published and relatedHome.section = :homeSection and " +
        "relatedHome.projectId = related.id and relatedHome.visibility = :publicVisibility) then related.name else null end), " +
        "course.name, course.field, p.courseId, p.chapterOrder, p.pinOrder, p.viewCount, p.techSeriesOrder) " +
        "from PostEntity p left join CourseEntity course on course.id = p.courseId " +
        "left join ProjectEntity project on project.id = p.projectId " +
        "left join PostEntity home on home.id = project.homePostId " +
        "left join ProjectEntity related on related.id = p.relatedProjectId " +
        "left join PostEntity relatedHome on relatedHome.id = related.homePostId " +
        "where p.status = :published and (p.section = :tech or p.section = :note or " +
        "(p.section = :projectDoc and home.status = :published and home.section = :homeSection " +
        "and home.projectId = project.id)) " +
        "and (:section is null or p.section = :section) " +
        "and (:includePrivate = true or (p.visibility = :publicVisibility and " +
        "(p.section <> :projectDoc or (project.visibility = :publicVisibility and home.visibility = :publicVisibility)))) " +
        "and (:pinnedOnly = false or p.pinOrder is not null) " +
        "and (:categoryPath is null or exists (select c.id from CategoryEntity c where c.id = p.categoryId " +
        "and (c.path = :categoryPath or c.path like :descendantPath))) " +
        "and (:tag is null or exists (select t.id from PostTagEntity t where t.postId = p.id and t.name = :tag)) " +
        "order by case when :pinnedOnly = true then p.pinOrder else null end asc, " +
        "case when :seriesOrder = true and p.techSeriesOrder is null then 0 " +
        "when :seriesOrder = true then 1 else null end asc, " +
        "case when :seriesOrder = true then p.techSeriesOrder else null end asc, " +
        "case when :seriesOrder = true then p.publishedAt else null end asc, " +
        "case when :seriesOrder = false then p.publishedAt else null end desc, " +
        "case when :seriesOrder = true then p.id else null end asc, " +
        "case when :seriesOrder = false then p.id else null end desc",
        countQuery = "select count(p) from PostEntity p " +
            "left join ProjectEntity project on project.id = p.projectId " +
            "left join PostEntity home on home.id = project.homePostId " +
            "where p.status = :published and (p.section = :tech or p.section = :note or " +
            "(p.section = :projectDoc and home.status = :published and home.section = :homeSection " +
            "and home.projectId = project.id)) and (:section is null or p.section = :section) " +
            "and (:includePrivate = true or (p.visibility = :publicVisibility and " +
            "(p.section <> :projectDoc or (project.visibility = :publicVisibility and home.visibility = :publicVisibility)))) " +
            "and (:pinnedOnly = false or p.pinOrder is not null) " +
            "and (:categoryPath is null or exists (select c.id from CategoryEntity c where c.id = p.categoryId " +
            "and (c.path = :categoryPath or c.path like :descendantPath))) " +
            "and (:tag is null or exists (select t.id from PostTagEntity t where t.postId = p.id and t.name = :tag))")
    fun feed(@Param("published") published: PostStatus, @Param("tech") tech: PostSection,
        @Param("note") note: PostSection, @Param("projectDoc") projectDoc: PostSection,
        @Param("section") section: PostSection?,
        @Param("homeSection") homeSection: PostSection,
        @Param("publicVisibility") publicVisibility: PostVisibility, @Param("includePrivate") includePrivate: Boolean,
        @Param("pinnedOnly") pinnedOnly: Boolean, @Param("seriesOrder") seriesOrder: Boolean,
        @Param("categoryPath") categoryPath: String?,
        @Param("descendantPath") descendantPath: String?, @Param("tag") tag: String?,
        pageable: Pageable): Page<ContentFeedRow>

    /** @return 제목·본문·태그·분류·과목 이름을 부분 문자열로 찾되 공개 부모 경계를 적용한 페이지. */
    @Query(value = "select new io.github.gjaku1031.kenblog.post.dto.ContentFeedRow(" +
        "p.id, p.title, p.slug, p.section, case when p.section = :homeSection then project.overview else p.summary end, p.publishedAt, p.visibility, p.categoryId, " +
        "coalesce(project.slug, case when :includePrivate = true or (related.visibility = :publicVisibility and " +
        "relatedHome.status = :published and relatedHome.section = :homeSection and " +
        "relatedHome.projectId = related.id and relatedHome.visibility = :publicVisibility) then related.slug else null end), " +
        "course.slug, coalesce(project.name, case when :includePrivate = true or (related.visibility = :publicVisibility and " +
        "relatedHome.status = :published and relatedHome.section = :homeSection and " +
        "relatedHome.projectId = related.id and relatedHome.visibility = :publicVisibility) then related.name else null end), " +
        "course.name, course.field, p.courseId, p.chapterOrder, p.pinOrder, p.viewCount, p.techSeriesOrder) " +
        "from PostEntity p left join ProjectEntity project on project.id = p.projectId " +
        "left join PostEntity home on home.id = project.homePostId " +
        "left join ProjectEntity related on related.id = p.relatedProjectId " +
        "left join PostEntity relatedHome on relatedHome.id = related.homePostId " +
        "left join CourseEntity course on course.id = p.courseId " +
        "left join CategoryEntity category on category.id = p.categoryId " +
        "where p.status = :published and p.section <> :homeSection " +
        "and (p.section not in (:projectDoc, :homeSection) or (home.status = :published and home.section = :homeSection " +
        "and home.projectId = project.id and (p.section <> :homeSection or p.id = home.id))) " +
        "and (:includePrivate = true or (p.visibility = :publicVisibility and " +
        "(p.section not in (:projectDoc, :homeSection) or (project.visibility = :publicVisibility and home.visibility = :publicVisibility)))) " +
        "and (locate(:query, lower(p.title)) > 0 or locate(:query, lower(p.body)) > 0 " +
        "or locate(:query, lower(p.summary)) > 0 or locate(:query, lower(project.overview)) > 0 " +
        "or locate(:query, lower(category.path)) > 0 " +
        "or locate(:query, lower(course.field)) > 0 or locate(:query, lower(course.name)) > 0 " +
        "or exists (select t.id from PostTagEntity t where t.postId = p.id and locate(:query, lower(t.name)) > 0)) " +
        "order by p.publishedAt desc, p.id desc",
        countQuery = "select count(p) from PostEntity p left join ProjectEntity project on project.id = p.projectId " +
            "left join PostEntity home on home.id = project.homePostId " +
            "left join CourseEntity course on course.id = p.courseId " +
            "left join CategoryEntity category on category.id = p.categoryId " +
            "where p.status = :published and p.section <> :homeSection " +
            "and (p.section not in (:projectDoc, :homeSection) or (home.status = :published and home.section = :homeSection " +
            "and home.projectId = project.id and (p.section <> :homeSection or p.id = home.id))) " +
            "and (:includePrivate = true or (p.visibility = :publicVisibility and " +
            "(p.section not in (:projectDoc, :homeSection) or (project.visibility = :publicVisibility and home.visibility = :publicVisibility)))) " +
            "and (locate(:query, lower(p.title)) > 0 or locate(:query, lower(p.body)) > 0 " +
            "or locate(:query, lower(p.summary)) > 0 or locate(:query, lower(project.overview)) > 0 " +
            "or locate(:query, lower(category.path)) > 0 " +
            "or locate(:query, lower(course.field)) > 0 or locate(:query, lower(course.name)) > 0 " +
            "or exists (select t.id from PostTagEntity t where t.postId = p.id and locate(:query, lower(t.name)) > 0))")
    fun search(@Param("published") published: PostStatus, @Param("homeSection") homeSection: PostSection,
        @Param("projectDoc") projectDoc: PostSection, @Param("publicVisibility") publicVisibility: PostVisibility,
        @Param("includePrivate") includePrivate: Boolean, @Param("query") query: String,
        pageable: Pageable): Page<ContentFeedRow>
}
