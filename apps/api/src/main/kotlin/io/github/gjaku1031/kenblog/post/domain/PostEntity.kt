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
}
