package io.github.gjaku1031.kenblog.attachment.domain

import io.github.gjaku1031.kenblog.draft.domain.EditorDraftEntity
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import jakarta.persistence.Column
import jakarta.persistence.Embeddable
import jakarta.persistence.EmbeddedId
import jakarta.persistence.Entity
import jakarta.persistence.FetchType
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table
import java.io.Serializable
import org.hibernate.annotations.OnDelete
import org.hibernate.annotations.OnDeleteAction

/** 게시글과 첨부의 중복 없는 연결 키. */
@Embeddable
data class PostAttachmentId(
    @Column(name = "post_id") var postId: Long = 0,
    @Column(name = "attachment_id") var attachmentId: Long = 0,
) : Serializable

/** 공개 글별 이미지 읽기 권한을 선언하는 FK 연결 행. */
@Entity
@Table(name = "post_attachments")
class PostAttachmentEntity protected constructor() {
    // DB 외래 키와 삭제 규칙. 저장은 기존 ID 필드를 사용.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private var post: PostEntity? = null

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "attachment_id", insertable = false, updatable = false)
    private var attachment: AttachmentEntity? = null

    @EmbeddedId
    var key: PostAttachmentId = PostAttachmentId()
        protected set

    /**
     * @param postId 잠근 게시글 ID
     * @param attachmentId 검증한 READY 첨부 ID
     */
    internal constructor(postId: Long, attachmentId: Long) : this() {
        key = PostAttachmentId(postId, attachmentId)
    }
}

/** 편집본과 첨부의 중복 없는 연결 키. */
@Embeddable
data class EditorDraftAttachmentId(
    @Column(name = "editor_draft_id") var editorDraftId: Long = 0,
    @Column(name = "attachment_id") var attachmentId: Long = 0,
) : Serializable

/** 출간 전 편집본에서만 사용되는 이미지 연결 행. */
@Entity
@Table(name = "editor_draft_attachments")
class EditorDraftAttachmentEntity protected constructor() {
    // DB 외래 키와 삭제 규칙. 저장은 기존 ID 필드를 사용.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "editor_draft_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private var draft: EditorDraftEntity? = null

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "attachment_id", insertable = false, updatable = false)
    private var attachment: AttachmentEntity? = null

    @EmbeddedId
    var key: EditorDraftAttachmentId = EditorDraftAttachmentId()
        protected set

    /**
     * @param draftId 잠근 편집본 ID
     * @param attachmentId 검증한 READY 첨부 ID
     */
    internal constructor(draftId: Long, attachmentId: Long) : this() {
        key = EditorDraftAttachmentId(draftId, attachmentId)
    }
}
