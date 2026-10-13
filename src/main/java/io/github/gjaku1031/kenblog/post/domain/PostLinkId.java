package io.github.gjaku1031.kenblog.post.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.Objects;

/**
 * 글과 연결한 글의 중복 없는 연결 키
 */
@Embeddable
public final class PostLinkId implements Serializable {
    /**
     * 게시글 ID
     */
    @Column(name = "post_id")
    private long postId;

    /**
     * 연결한 게시글 ID
     */
    @Column(name = "linked_post_id")
    private long linkedPostId;

    /**
     * JPA 복합 키 초기화
     */
    protected PostLinkId() {}

    /**
     * 연결 식별자 초기화
     */
    public PostLinkId(long postId, long linkedPostId) {
        this.postId = postId;
        this.linkedPostId = linkedPostId;
    }

    /**
     * postId 조회
     */
    public long getPostId() {
        return postId;
    }

    /**
     * linkedPostId 조회
     */
    public long getLinkedPostId() {
        return linkedPostId;
    }

    /**
     * 복합 키 값 비교
     */
    @Override
    public boolean equals(Object other) {
        return other instanceof PostLinkId key
                && postId == key.postId
                && linkedPostId == key.linkedPostId;
    }

    /**
     * 복합 키 해시
     */
    @Override
    public int hashCode() {
        return Objects.hash(postId, linkedPostId);
    }
}
