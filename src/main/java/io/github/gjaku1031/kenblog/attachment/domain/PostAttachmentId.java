package io.github.gjaku1031.kenblog.attachment.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.Objects;

/**
 * 게시글과 첨부의 중복 없는 연결 키
 */
@Embeddable
public final class PostAttachmentId implements Serializable {
    /**
     * 게시글 ID
     */
    @Column(name = "post_id")
    private long postId;

    /**
     * 첨부 ID
     */
    @Column(name = "attachment_id")
    private long attachmentId;

    /**
     * JPA 복합 키 초기화
     */
    protected PostAttachmentId() {}

    /**
     * 연결 식별자 초기화
     */
    public PostAttachmentId(long postId, long attachmentId) {
        this.postId = postId;
        this.attachmentId = attachmentId;
    }

    /**
     * postId 조회
     */
    public long getPostId() {
        return postId;
    }

    /**
     * attachmentId 조회
     */
    public long getAttachmentId() {
        return attachmentId;
    }

    /**
     * 복합 키 값 비교
     */
    @Override
    public boolean equals(Object other) {
        return other instanceof PostAttachmentId key
                && postId == key.postId
                && attachmentId == key.attachmentId;
    }

    /**
     * 복합 키 해시
     */
    @Override
    public int hashCode() {
        return Objects.hash(postId, attachmentId);
    }
}
