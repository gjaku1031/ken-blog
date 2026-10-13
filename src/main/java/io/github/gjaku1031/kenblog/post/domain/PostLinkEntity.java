package io.github.gjaku1031.kenblog.post.domain;

import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

/**
 * 관리자에게만 보이는 글 사이의 연결 행
 * 방향 없이 양쪽 글에서 서로를 조회하며, 쓰기는 운영 절차의 SQL이 담당
 */
@Entity
@Table(name = "post_links")
public class PostLinkEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected PostLinkEntity() {}

    // DB 외래 키와 삭제 규칙 저장은 기존 ID 필드를 사용

    /**
     * 게시글 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private PostEntity post = null;

    /**
     * 연결한 게시글 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "linked_post_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private PostEntity linkedPost = null;

    /**
     * 복합 키
     */
    @EmbeddedId private PostLinkId key = new PostLinkId();

    /**
     * key 조회
     */
    public PostLinkId getKey() {
        return key;
    }

    /**
     * JPA 프록시의 key 변경
     */
    protected void setKey(PostLinkId key) {
        this.key = key;
    }
}
