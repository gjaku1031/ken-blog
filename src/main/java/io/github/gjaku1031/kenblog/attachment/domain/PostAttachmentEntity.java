package io.github.gjaku1031.kenblog.attachment.domain;

import io.github.gjaku1031.kenblog.post.domain.PostEntity;

import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

/**
 * 공개 글별 이미지 읽기 권한을 선언하는 FK 연결 행
 */
@Entity
@Table(name = "post_attachments")
public class PostAttachmentEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected PostAttachmentEntity() {}

    // DB 외래 키와 삭제 규칙 저장은 기존 ID 필드를 사용

    /**
     * 게시글 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private PostEntity post = null;

    /**
     * 첨부 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "attachment_id", insertable = false, updatable = false)
    private AttachmentEntity attachment = null;

    /**
     * 복합 키
     */
    @EmbeddedId private PostAttachmentId key = new PostAttachmentId();

    /**
     * 연결 키 초기화
     *
     * @param postId 잠근 게시글 ID
     * @param attachmentId 검증한 READY 첨부 ID
     */
    public PostAttachmentEntity(long postId, long attachmentId) {
        key = new PostAttachmentId(postId, attachmentId);
    }

    /**
     * key 조회
     */
    public PostAttachmentId getKey() {
        return key;
    }

    /**
     * JPA 프록시의 key 변경
     */
    protected void setKey(PostAttachmentId key) {
        this.key = key;
    }
}
