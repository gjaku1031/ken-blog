package io.github.gjaku1031.kenblog.draft.domain

import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.project.domain.ProjectMetadata
import io.github.gjaku1031.kenblog.project.domain.ProjectStatus
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime

/**
 * 공개 원문 [io.github.gjaku1031.kenblog.post.domain.PostEntity]과 독립된 편집 스냅샷.
 *
 * [categoryId]는 삭제되어도 원고를 보존해야 하므로 FK를 걸지 않음. [tagsSnapshot]은
 * 제어문자를 거부한 태그들을 U+001F로 구분하며 목록·상세에서만 역직렬화함.
 */
@Entity
@Table(name = "editor_drafts")
class EditorDraftEntity protected constructor() {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(name = "post_id")
    var postId: Long? = null
        protected set

    @Column(name = "base_updated_at", columnDefinition = "datetime(6)")
    var baseUpdatedAt: LocalDateTime? = null
        protected set

    @Column(nullable = false)
    var revision: Long = 0
        protected set

    @Column(nullable = false, length = 200)
    lateinit var title: String
        protected set

    @Column(nullable = false, length = 160)
    lateinit var slug: String
        protected set

    @Column(nullable = false, columnDefinition = "longtext")
    lateinit var body: String
        protected set

    @Column(nullable = false, length = 120)
    var summary: String = ""
        protected set

    @Column(name = "category_id")
    var categoryId: Long? = null
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

    @Enumerated(EnumType.STRING)
    @Column(name = "project_status", length = 16)
    var projectStatus: ProjectStatus? = null
        protected set

    @Column(name = "project_start_period", length = 7)
    var projectStartPeriod: String? = null
        protected set

    @Column(name = "project_end_period", length = 7)
    var projectEndPeriod: String? = null
        protected set

    @Column(name = "project_overview", length = 500)
    var projectOverview: String? = null
        protected set

    @Column(name = "base_project_updated_at", columnDefinition = "datetime(6)")
    var baseProjectUpdatedAt: LocalDateTime? = null
        protected set

    @Column(name = "project_stack_names", columnDefinition = "text")
    var projectStackNames: String? = null
        protected set

    @Column(name = "tags_snapshot", nullable = false, length = 1024)
    lateinit var tagsSnapshot: String
        protected set

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    var visibility: PostVisibility = PostVisibility.PRIVATE
        protected set

    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var createdAt: LocalDateTime
        protected set

    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var updatedAt: LocalDateTime
        protected set

    /** 새 글 또는 특정 원본의 첫 편집본을 revision 0으로 구성. */
    internal constructor(postId: Long?, baseUpdatedAt: LocalDateTime?, values: EditorDraftValues, now: LocalDateTime) : this() {
        this.postId = postId
        this.baseUpdatedAt = baseUpdatedAt
        this.title = values.title
        this.slug = values.slug
        this.body = values.body
        this.summary = values.summary
        this.categoryId = values.categoryId
        assignProjectValues(values)
        this.tagsSnapshot = values.tags.joinToString(TAG_SEPARATOR)
        this.visibility = values.visibility
        this.createdAt = now
        this.updatedAt = now
    }

    /** 잠금·revision 확인 후 편집 내용만 교체하고 원본 기준은 유지. */
    internal fun replace(values: EditorDraftValues, now: LocalDateTime) {
        if (revision == Long.MAX_VALUE) throw EditorDraftConflictException()
        title = values.title
        slug = values.slug
        body = values.body
        summary = values.summary
        categoryId = values.categoryId
        assignProjectValues(values)
        tagsSnapshot = values.tags.joinToString(TAG_SEPARATOR)
        visibility = values.visibility
        revision += 1
        updatedAt = now
    }

    /** @return 저장 순서의 정규화 태그 목록. */
    fun tags(): List<String> = if (tagsSnapshot.isEmpty()) emptyList() else tagsSnapshot.split(TAG_SEPARATOR)

    /** @return HOME일 때만 존재하는 편집 메타데이터 스냅샷. */
    fun projectMetadata(): ProjectMetadata? = projectStatus?.let { status ->
        ProjectMetadata(status, projectStartPeriod ?: error("Missing project start period"),
            projectEndPeriod, projectOverview ?: error("Missing project overview"), visibility, baseProjectUpdatedAt,
            projectStackNames?.takeIf(String::isNotEmpty)?.split(TAG_SEPARATOR) ?: emptyList())
    }

    /** 섹션·소속·프로젝트 속성을 하나의 편집 값으로 교체. */
    private fun assignProjectValues(values: EditorDraftValues) {
        section = values.section
        projectId = values.projectId
        relatedProjectId = values.relatedProjectId
        documentOrder = values.documentOrder
        courseId = values.courseId
        chapterOrder = values.chapterOrder
        projectStatus = values.projectMetadata?.status
        projectStartPeriod = values.projectMetadata?.startPeriod
        projectEndPeriod = values.projectMetadata?.endPeriod
        projectOverview = values.projectMetadata?.overview
        baseProjectUpdatedAt = values.projectMetadata?.baseProjectUpdatedAt
        projectStackNames = values.projectMetadata?.stackBadgeNames?.joinToString(TAG_SEPARATOR)
    }

    private companion object { const val TAG_SEPARATOR = "\u001f" }
}

/** 저장 전에 검증된 편집본의 내용과 분류·태그·범위. */
data class EditorDraftValues(
    val title: String,
    val slug: String,
    val body: String,
    val categoryId: Long?,
    val tags: List<String>,
    val visibility: PostVisibility,
    val section: PostSection = PostSection.TECH,
    val projectId: Long? = null,
    val relatedProjectId: Long? = null,
    val documentOrder: Int? = null,
    val projectMetadata: ProjectMetadata? = null,
    val courseId: Long? = null,
    val chapterOrder: Int? = null,
    val summary: String = "",
)
