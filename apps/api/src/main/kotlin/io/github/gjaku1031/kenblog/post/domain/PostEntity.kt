package io.github.gjaku1031.kenblog.post.domain

import io.github.gjaku1031.kenblog.post.service.PostService
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime

/** 게시글의 임시 저장과 공개 출간 여부. */
enum class PostStatus { DRAFT, PUBLISHED }

/** 출간된 글을 익명 방문자에게도 보일지 결정하는 범위. */
enum class PostVisibility { PUBLIC, PRIVATE }

/** Tech 글·프로젝트 대문·문서의 공개 탐색 구획. */
enum class PostSection { TECH, PROJECT_HOME, PROJECT_DOC, NOTE_CHAPTER }

/**
 * Flyway의 `posts` 행에 대응하는 초안·출간 게시글 저장 모델.
 *
 * 시간은 UTC의 [LocalDateTime]으로 저장하며 생성 시 [updatedAt]은 [createdAt]과 같음.
 * [replaceDraft]는 출간 상태를 건드리지 않고 검증된 내용만 교체함.
 * 최초 [publishedAt]은 철회·재출간·공개 범위 변경에도 유지함.
 */
@Entity
@Table(name = "posts")
class PostEntity protected constructor() {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(nullable = false, length = 200)
    lateinit var title: String
        protected set

    @Column(nullable = false, length = 160, unique = true)
    lateinit var slug: String
        protected set

    @Column(nullable = false, columnDefinition = "longtext")
    lateinit var body: String
        protected set

    @Column(name = "body_sha256", nullable = false, length = 64, columnDefinition = "char(64)")
    lateinit var bodySha256: String
        protected set

    @Column(nullable = false, length = 120)
    var summary: String = ""
        protected set

    @Column(name = "pin_order")
    var pinOrder: Int? = null
        protected set

    @Column(name = "view_count", nullable = false)
    var viewCount: Long = 0
        protected set

    @Column(name = "category_id")
    var categoryId: Long? = null
        protected set

    @Column(name = "tech_series_order")
    var techSeriesOrder: Int? = null
        protected set

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    var section: PostSection = PostSection.TECH
        protected set

    @Column(name = "project_id")
    var projectId: Long? = null
        protected set

    @Column(name = "related_project_id")
    var relatedProjectId: Long? = null
        protected set

    @Column(name = "document_order")
    var documentOrder: Int? = null
        protected set

    @Column(name = "course_id")
    var courseId: Long? = null
        protected set

    @Column(name = "chapter_order")
    var chapterOrder: Int? = null
        protected set

    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var createdAt: LocalDateTime
        protected set

    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var updatedAt: LocalDateTime
        protected set

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    var status: PostStatus = PostStatus.DRAFT
        protected set

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    var visibility: PostVisibility = PostVisibility.PRIVATE
        protected set

    @Column(name = "published_at", columnDefinition = "datetime(6)")
    var publishedAt: LocalDateTime? = null
        protected set

    /**
     * 검증된 초안과 UTC 시각으로 새 영속 객체를 생성.
     *
     * 호출자는 [PostService.createDraft]를 통해 입력을 먼저 검증해야 함.
     *
     * @param title 앞뒤 공백을 제거한 제목
     * @param slug 정규화한 고유 주소
     * @param body UTF-8로 1 MiB 이하인 초안 본문
     * @param createdAt 생성 및 최초 수정 시각
     */
    internal constructor(title: String, slug: String, body: String, createdAt: LocalDateTime) : this() {
        this.title = title
        this.slug = slug
        this.body = body
        this.bodySha256 = PostBodyHash.sha256(body)
        this.createdAt = createdAt
        this.updatedAt = createdAt
    }

    /**
     * [PostService.updateDraft]에서 검증한 전체 초안 내용을 한 트랜잭션에서 교체.
     *
     * @param title 정규화한 제목
     * @param slug 정규화한 slug
     * @param body 원문 그대로 저장할 본문
     * @param updatedAt UTC 수정 시각
     */
    internal fun replaceDraft(title: String, slug: String, body: String, updatedAt: LocalDateTime) {
        this.title = title
        this.slug = slug
        this.body = body
        this.bodySha256 = PostBodyHash.sha256(body)
        this.updatedAt = updatedAt
    }

    /**
     * 출간 또는 재출간하고 최초 UTC 출간 시각을 보존.
     *
     * 상태·범위가 이미 같다면 수정 시각도 유지함.
     *
     * @param visibility 새 [PostVisibility]
     * @param now UTC 상태 변경 시각
     */
    internal fun publish(visibility: PostVisibility, now: LocalDateTime) {
        if (status == PostStatus.PUBLISHED && this.visibility == visibility) return
        if (publishedAt == null) publishedAt = now
        status = PostStatus.PUBLISHED
        this.visibility = visibility
        updatedAt = now
    }

    /**
     * 초안으로 되돌리되 [publishedAt]과 설정한 [visibility]를 보존.
     *
     * @param now UTC 상태 변경 시각
     */
    internal fun unpublish(now: LocalDateTime) {
        if (status == PostStatus.DRAFT) return
        status = PostStatus.DRAFT
        updatedAt = now
    }

    /**
     * 출간 상태와 최초 출간 시각을 유지한 채 공개 범위만 변경.
     *
     * @param visibility 새 [PostVisibility]
     * @param now UTC 범위 변경 시각
     */
    internal fun changeVisibility(visibility: PostVisibility, now: LocalDateTime) {
        if (this.visibility == visibility) return
        this.visibility = visibility
        updatedAt = now
    }

    /**
     * 본문·출간 상태를 건드리지 않고 연결한 분류 ID와 수정 시각을 바꿈.
     *
     * @param categoryId 현재 존재 확인을 마친 분류 ID 또는 해제를 뜻하는 `null`
     * @param now UTC 수정 시각
     */
    internal fun changeCategory(categoryId: Long?, now: LocalDateTime) {
        if (this.categoryId != categoryId) this.techSeriesOrder = null
        this.categoryId = categoryId
        this.updatedAt = now
    }

    /** [PostService]가 검증한 TECH 소분류 번호를 원문 수정 시각과 함께 적용. */
    internal fun changeTechSeriesOrder(order: Int?, now: LocalDateTime) {
        techSeriesOrder = order
        updatedAt = now
    }

    /** 새 PROJECT_HOME 또는 PROJECT_DOC 글의 소속과 문서 순서를 지정. */
    internal fun assignProject(section: PostSection, projectId: Long, documentOrder: Int?) {
        this.section = section
        this.projectId = projectId
        this.relatedProjectId = null
        this.documentOrder = documentOrder
    }

    /** 새 회차에 과목 식별자와 삭제 후에도 유지되는 저장 순서를 지정. */
    internal fun assignCourse(courseId: Long, chapterOrder: Int) {
        section = PostSection.NOTE_CHAPTER
        this.courseId = courseId
        this.chapterOrder = chapterOrder
    }

    /** 과목 잠금 아래 순서만 변경해 공개 본문의 수정 기준 시각을 보존. */
    internal fun reorderChapter(order: Int) { chapterOrder = order }

    /** 편집본 출간의 명시 요약 또는 자동 추출 문장을 저장. */
    internal fun replaceSummary(value: String) { summary = value }

    /** 핀 전체 순열 교체에서 본문 수정 시각을 유지한 채 위치만 저장. */
    internal fun movePin(order: Int?) { pinOrder = order }

    /** TECH 글의 관련 프로젝트를 저장하거나 해제. */
    internal fun relateProject(projectId: Long?, now: LocalDateTime) {
        relatedProjectId = projectId
        updatedAt = now
    }

    /** 부모 프로젝트 잠금 아래 문서 순서만 변경해 본문 편집본 기준 시각을 보존. */
    internal fun reorder(order: Int) {
        documentOrder = order
    }
}
