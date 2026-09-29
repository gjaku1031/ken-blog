package io.github.gjaku1031.kenblog.note.repository

import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.note.dto.ChapterRow
import io.github.gjaku1031.kenblog.note.dto.AdminChapterResponse
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** 과목에 속한 회차의 순서와 권한별 출간 목록을 조회하는 저장소. */
interface CoursePostRepository : JpaRepository<PostEntity, Long> {
    /** @return 관리자 순서·삭제에 사용할 본문 없는 전체 회차. */
    @Query("select new io.github.gjaku1031.kenblog.note.dto.AdminChapterResponse(" +
        "p.id, p.title, p.slug, p.chapterOrder, p.status, p.visibility) from PostEntity p " +
        "where p.courseId = :courseId order by p.chapterOrder asc, p.id asc")
    fun findAdminChapters(@Param("courseId") courseId: Long): List<AdminChapterResponse>

    /** @return 회차 삭제 전에 배타 잠금한 현재 과목 글. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PostEntity p where p.id = :id and p.courseId = :courseId")
    fun findLockedChapter(@Param("id") id: Long, @Param("courseId") courseId: Long): PostEntity?

    /** @return 현재 역할로 보이는 회차를 저장 순서로 정렬한 목록. */
    @Query("select new io.github.gjaku1031.kenblog.note.dto.ChapterRow(" +
        "p.id, p.title, p.slug, p.chapterOrder, p.publishedAt, p.visibility, p.summary) from PostEntity p " +
        "where p.courseId = :courseId and p.section = :section " +
        "and p.status = :published and (:includePrivate = true or p.visibility = :publicVisibility) " +
        "order by p.chapterOrder asc, p.id asc")
    fun findVisibleChapters(@Param("courseId") courseId: Long, @Param("section") section: PostSection,
        @Param("published") published: PostStatus, @Param("includePrivate") includePrivate: Boolean,
        @Param("publicVisibility") publicVisibility: PostVisibility): List<ChapterRow>

    /** @return 직접 주소의 출간 회차를 본문 없이 찾은 현재 상태. */
    @Query("select new io.github.gjaku1031.kenblog.note.dto.ChapterRow(" +
        "p.id, p.title, p.slug, p.chapterOrder, p.publishedAt, p.visibility, p.summary) from PostEntity p " +
        "where p.courseId = :courseId and p.slug = :slug and p.section = :section and p.status = :published")
    fun findPublishedBySlug(@Param("courseId") courseId: Long, @Param("slug") slug: String,
        @Param("section") section: PostSection, @Param("published") published: PostStatus): ChapterRow?

    /** @return 과목 잠금 아래 새 회차에 부여할 마지막 저장 순서. */
    @Query("select max(p.chapterOrder) from PostEntity p where p.courseId = :courseId")
    fun maxChapterOrder(@Param("courseId") courseId: Long): Int?
}
