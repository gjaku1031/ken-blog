package io.github.gjaku1031.kenblog.post.domain

import io.github.gjaku1031.kenblog.post.service.PostService
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime

/**
 * Flyway의 `posts` 행에 대응하는 초안 저장 모델.
 *
 * 시간은 UTC의 [LocalDateTime]으로 저장하며 생성 시 [updatedAt]은 [createdAt]과 같음.
 * 수정 기능은 아직 없으므로 생성 이후 필드를 변경하는 공개 메서드가 없음.
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
}
