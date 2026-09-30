package io.github.gjaku1031.kenblog.post.domain

import io.github.gjaku1031.kenblog.draft.domain.EditorDraftEntity
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

/** 게시글 본문과 함께 관리자가 선언한 제목 참조 한 개. */
@Entity
@Table(name = "post_wiki_links", uniqueConstraints = [
    UniqueConstraint(name = "uk_post_wiki_links_title", columnNames = ["post_id", "target_title"]),
])
class PostWikiLinkEntity protected constructor() {
    // DB 외래 키와 삭제 규칙. 저장은 기존 ID 필드를 사용.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private var post: PostEntity? = null

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

    @Column(name = "target_title", nullable = false, length = 200, columnDefinition = "varchar(200) character set utf8mb4 collate utf8mb4_bin")
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
@Table(name = "editor_draft_wiki_links", uniqueConstraints = [
    UniqueConstraint(name = "uk_editor_draft_wiki_links_title", columnNames = ["editor_draft_id", "target_title"]),
])
class EditorDraftWikiLinkEntity protected constructor() {
    // DB 외래 키와 삭제 규칙. 저장은 기존 ID 필드를 사용.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "editor_draft_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private var draft: EditorDraftEntity? = null

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

    @Column(name = "target_title", nullable = false, length = 200, columnDefinition = "varchar(200) character set utf8mb4 collate utf8mb4_bin")
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
