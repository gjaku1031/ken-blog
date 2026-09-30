package io.github.gjaku1031.kenblog.note.service

import io.github.gjaku1031.kenblog.deployment.ContentMutation
import io.github.gjaku1031.kenblog.deployment.PublicationChange

import io.github.gjaku1031.kenblog.note.domain.CourseConflictException
import io.github.gjaku1031.kenblog.note.domain.CourseEntity
import io.github.gjaku1031.kenblog.note.domain.CourseNotFoundException
import io.github.gjaku1031.kenblog.note.domain.InvalidCourseRequestException
import io.github.gjaku1031.kenblog.note.dto.AdminChapterResponse
import io.github.gjaku1031.kenblog.note.dto.ChapterDetailResponse
import io.github.gjaku1031.kenblog.note.dto.ChapterRow
import io.github.gjaku1031.kenblog.note.dto.ChapterSummaryResponse
import io.github.gjaku1031.kenblog.note.dto.CourseAdminDetailResponse
import io.github.gjaku1031.kenblog.note.dto.CourseChapterResponse
import io.github.gjaku1031.kenblog.note.dto.CourseDetailResponse
import io.github.gjaku1031.kenblog.note.dto.CourseSummaryResponse
import io.github.gjaku1031.kenblog.note.dto.CourseWriteRequest
import io.github.gjaku1031.kenblog.note.dto.NotesListResponse
import io.github.gjaku1031.kenblog.note.dto.adminResponse
import io.github.gjaku1031.kenblog.note.repository.CoursePostRepository
import io.github.gjaku1031.kenblog.note.repository.CourseRepository
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.ContentAddress
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.service.PostService
import java.time.Clock
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.Locale
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.repository.findByIdOrNull
import org.springframework.security.core.Authentication
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** Notes 과목·회차의 저장 순서와 권한별 표시 번호를 일치시키는 서비스. */
@Service
class CourseService(private val courses: CourseRepository, private val chapters: CoursePostRepository,
    private val posts: PostService) {
    /** @return 분야 생성 순서와 권한별 회차 수를 가진 과목 카드 전체. */
    @Transactional(readOnly = true)
    fun list(authentication: Authentication?): NotesListResponse = NotesListResponse(
        courses.findAllByOrderByCreatedAtAscIdAsc().map { it.summary(false) })

    /** @return PUBLIC 출간 회차만 집계한 관리자 과목 목록. */
    @Transactional(readOnly = true)
    fun adminList(): NotesListResponse = NotesListResponse(
        courses.findAllByOrderByCreatedAtAscIdAsc().map { it.summary(false) })

    /** @return 출간 회차만 포함하는 과목 소개. */
    @Transactional(readOnly = true)
    fun detail(rawSlug: String, authentication: Authentication?): CourseDetailResponse {
        val course = bySlug(rawSlug)
        val visible = visible(course.id!!, false)
        return CourseDetailResponse(course.summary(visible), visible.mapIndexed { index, post -> post.summary(index + 1) })
    }

    /** @return 직접 주소로 연 회차의 현재 권한 표시 번호와 탐색 목록. */
    @Transactional(readOnly = true)
    fun chapter(rawSlug: String, chapterSlug: String, authentication: Authentication?): CourseChapterResponse {
        val course = bySlug(rawSlug)
        val includePrivate = false
        val visible = visible(course.id!!, includePrivate)
        val post = chapters.findPublishedBySlug(course.id!!, chapterSlug, PostSection.NOTE_CHAPTER,
            PostStatus.PUBLISHED)
            ?: throw CourseNotFoundException()
        val position = visible.indexOfFirst { it.id == post.id }
        if (position < 0) throw CourseNotFoundException()
        val readable = chapters.findByIdOrNull(post.id) ?: throw CourseNotFoundException()
        val body = readable.body
        val response = ChapterDetailResponse(post.id, post.title, post.slug, body,
            post.publishedAt.kstDate(), false, courseSlug = course.slug, bodySha256 = readable.bodySha256)
        return CourseChapterResponse(course.summary(visible), response,
            visible.mapIndexed { index, item -> item.summary(index + 1) }, position + 1, visible.size)
    }

    /** @return 과목 생성과 DB 고유 주소 확인을 마친 관리자 값. */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun create(request: CourseWriteRequest): io.github.gjaku1031.kenblog.note.dto.CourseAdminResponse = conflicts {
        courses.saveAndFlush(CourseEntity(ContentAddress.createCourse(), request.field, request.name,
            request.description, request.status, now())).adminResponse()
    }

    /** @return 과목 행을 잠그고 소개 값을 교체한 관리자 값. */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun update(id: Long, request: CourseWriteRequest): io.github.gjaku1031.kenblog.note.dto.CourseAdminResponse = conflicts {
        val course = lockedParent(id)
        course.replace(request.field, request.name, request.description, request.status, now())
        courses.saveAndFlush(course).adminResponse()
    }

    /** @return 비출간 회차를 포함한 관리자 과목 상세. */
    @Transactional(readOnly = true)
    fun adminDetail(id: Long): CourseAdminDetailResponse {
        if (id <= 0) throw InvalidCourseRequestException()
        val course = courses.findByIdOrNull(id) ?: throw CourseNotFoundException()
        return CourseAdminDetailResponse(course.adminResponse(), chapters.findAdminChapters(id))
    }

    /** @return 과목 행을 먼저 배타 잠금한 객체. */
    @Transactional
    fun lockedParent(id: Long): CourseEntity {
        if (id <= 0) throw InvalidCourseRequestException()
        return courses.findLockedById(id) ?: throw CourseNotFoundException()
    }

    /** @return 회차 편집본 생성 중 삭제를 막는 공유 잠금 과목. */
    @Transactional
    fun sharedParent(id: Long): CourseEntity {
        if (id <= 0) throw InvalidCourseRequestException()
        return courses.findSharedById(id) ?: throw CourseNotFoundException()
    }

    /** @return 삭제된 과목을 출간하지 않도록 재검사한 부모. */
    @Transactional(readOnly = true)
    fun requireParent(id: Long): CourseEntity = courses.findByIdOrNull(id) ?: throw CourseNotFoundException()

    /** @return 과목 잠금 아래 다음 회차의 저장 순서. */
    @Transactional
    fun nextChapterOrder(id: Long): Int {
        val max = chapters.maxChapterOrder(id) ?: 0
        if (max == Int.MAX_VALUE) throw CourseConflictException()
        return max + 1
    }

    /** 과목 잠금 뒤 회차 한 건과 그 DB 연결을 삭제. */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun deleteChapter(id: Long, postId: Long) = conflicts {
        lockedParent(id)
        if (postId <= 0) throw InvalidCourseRequestException()
        val post = chapters.findLockedChapter(postId, id) ?: throw CourseNotFoundException()
        if (post.section != PostSection.NOTE_CHAPTER) throw CourseConflictException()
        chapters.delete(post)
        chapters.flush()
    }

    /** 과목과 회차를 함께 삭제하며 OCI 원본 객체는 보존. */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun delete(id: Long) = conflicts {
        val course = lockedParent(id)
        chapters.deleteAllByIdInBatch(chapters.findAdminChapters(id).map { it.id })
        courses.delete(course)
        courses.flush()
    }

    /** @return slug 형식과 존재를 확인한 과목. */
    private fun bySlug(raw: String): CourseEntity {
        val slug = raw.trim().lowercase(Locale.ROOT)
        if (slug.length > 160 || !Regex("[a-z0-9]+(?:-[a-z0-9]+)*").matches(slug)) throw CourseNotFoundException()
        return courses.findBySlug(slug) ?: throw CourseNotFoundException()
    }

    /** @return 출간·공개 범위를 SQL에서 필터한 회차. */
    private fun visible(id: Long, includePrivate: Boolean): List<ChapterRow> =
        chapters.findVisibleChapters(id, PostSection.NOTE_CHAPTER, PostStatus.PUBLISHED,
            includePrivate, PostVisibility.PUBLIC)

    /** @return 이미 구한 회차 목록으로 건수·최신일을 만든 과목 카드. */
    private fun CourseEntity.summary(items: List<ChapterRow>): CourseSummaryResponse =
        CourseSummaryResponse(id!!, slug, field, name, description, status, items.size,
            items.mapNotNull { it.publishedAt }.maxOrNull()?.kstDate())

    /** @return 권한에 맞는 회차를 조회해 만든 카드. */
    private fun CourseEntity.summary(includePrivate: Boolean): CourseSummaryResponse =
        summary(visible(id!!, includePrivate))

    /** @return [ChapterSummaryResponse]에 권한 필터의 같은 위치와 저장 요약을 적용한 사이드바 행. */
    private fun ChapterRow.summary(position: Int): ChapterSummaryResponse =
        ChapterSummaryResponse(id, title, slug, position, publishedAt.kstDate(), visibility,
            summary.takeIf(String::isNotBlank))

    /** @return UTC 최초 출간 시각의 KST 날짜. */
    private fun LocalDateTime?.kstDate(): LocalDate = (this ?: throw CourseConflictException())
        .atZone(ZoneOffset.UTC).withZoneSameInstant(ZoneId.of("Asia/Seoul")).toLocalDate()

    /** @return 현재 UTC를 MySQL DATETIME(6) 정밀도로 자른 시각. */
    private fun now(): LocalDateTime = LocalDateTime.ofInstant(
        Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)

    /** @return 고유 주소·FK 경합을 공개 가능한 409로 변환. */
    private inline fun <T> conflicts(action: () -> T): T = try { action() }
        catch (ex: DataIntegrityViolationException) { throw CourseConflictException() }

}
