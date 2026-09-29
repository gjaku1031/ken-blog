package io.github.gjaku1031.kenblog.post.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table

/** 게시글 본문과 함께 관리자가 선언한 제목 참조 한 개. */
@Entity
@Table(name = "post_wiki_links")
class PostWikiLinkEntity protected constructor() {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(name = "post_id", nullable = false)
    var postId: Long = 0
        protected set

    @Column(nullable = false)
    var position: Int = 0
        protected set

    @Column(name = "target_title", nullable = false, length = 200)
    lateinit var targetTitle: String
        protected set

    /**
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

/** 출간 전 편집본에만 속하고 공개 역링크에는 쓰이지 않는 제목 참조. */
@Entity
@Table(name = "editor_draft_wiki_links")
class EditorDraftWikiLinkEntity protected constructor() {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(name = "editor_draft_id", nullable = false)
    var editorDraftId: Long = 0
        protected set

    @Column(nullable = false)
    var position: Int = 0
        protected set

    @Column(name = "target_title", nullable = false, length = 200)
    lateinit var targetTitle: String
        protected set

    /**
     * @param draftId 잠근 편집본 ID
     * @param position 선언 순서
     * @param targetTitle 검증한 대상 제목
     */
    internal constructor(draftId: Long, position: Int, targetTitle: String) : this() {
        this.editorDraftId = draftId
        this.position = position
        this.targetTitle = targetTitle
    }
}
