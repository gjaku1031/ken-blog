package io.github.gjaku1031.kenblog.post.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.FetchType
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import org.hibernate.annotations.OnDelete
import org.hibernate.annotations.OnDeleteAction

/**
 * 게시글 본문과 함께 관리자가 선언한 제목 참조 한 개
 */
@Entity
@Table(name = "post_wiki_links", uniqueConstraints = [
    UniqueConstraint(name = "uk_post_wiki_links_title", columnNames = ["post_id", "target_title"]),
])
open class PostWikiLinkEntity protected constructor() {
    // DB 외래 키와 삭제 규칙 저장은 기존 ID 필드를 사용

    /**
     * 게시글 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private var post: PostEntity? = null

    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    open var id: Long? = null
        protected set

    /**
     * 게시글 ID
     */
    @Column(name = "post_id", nullable = false)
    open var postId: Long = 0
        protected set

    /**
     * 입력 순서의 0 기반 위치
     */
    @Column(nullable = false)
    open var position: Int = 0
        protected set

    /**
     * 위키 대상 제목
     */
    @Column(name = "target_title", nullable = false, length = 200, columnDefinition = "varchar(200) character set utf8mb4 collate utf8mb4_bin")
    open lateinit var targetTitle: String
        protected set

    /**
     * 연결 키 초기화
     *
     * @param postId 잠근 게시글 ID
     * @param position 선언 순서
     * @param targetTitle 검증한 대상 제목
     */
    internal constructor(postId: Long, position: Int, targetTitle: String) : this() {
        this.postId = postId
        this.position = position
        this.targetTitle = targetTitle
    }
}
