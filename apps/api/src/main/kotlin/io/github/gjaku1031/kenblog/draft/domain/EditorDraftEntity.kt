package io.github.gjaku1031.kenblog.draft.domain

import io.github.gjaku1031.kenblog.post.domain.PostVisibility
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

    @Column(name = "category_id")
    var categoryId: Long? = null
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
        this.categoryId = values.categoryId
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
        categoryId = values.categoryId
        tagsSnapshot = values.tags.joinToString(TAG_SEPARATOR)
        visibility = values.visibility
        revision += 1
        updatedAt = now
    }

    /** @return 저장 순서의 정규화 태그 목록. */
    fun tags(): List<String> = if (tagsSnapshot.isEmpty()) emptyList() else tagsSnapshot.split(TAG_SEPARATOR)

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
)
