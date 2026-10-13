package io.github.gjaku1031.kenblog.post.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

import java.time.LocalDateTime;

/**
 * 공개하지 않은 글의 Markdown 본문
 * 공개 글의 본문은 저장소 원고에만 두므로 공개 전환 뒤에는 행이 없음
 * 애플리케이션은 읽기만 하고 쓰기는 운영 절차의 SQL이 담당
 */
@Entity
@Table(name = "post_bodies")
public class PostBodyEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected PostBodyEntity() {}

    // DB 외래 키와 삭제 규칙 저장은 기존 ID 필드를 사용

    /**
     * 게시글 FK 매핑, 글마다 한 행인 제약은 기본 키가 보장
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private PostEntity post = null;

    /**
     * 게시글 ID
     */
    @Id
    @Column(name = "post_id")
    private Long postId = null;

    /**
     * Markdown 본문
     */
    @Column(nullable = false, columnDefinition = "mediumtext")
    private String body;

    /**
     * 본문 수정 시각, 검수 대상 본문을 구분하는 기준
     */
    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    private LocalDateTime updatedAt;

    /**
     * postId 조회
     */
    public Long getPostId() {
        return postId;
    }

    /**
     * JPA 프록시의 postId 변경
     */
    protected void setPostId(Long postId) {
        this.postId = postId;
    }

    /**
     * body 조회
     */
    public String getBody() {
        return body;
    }

    /**
     * JPA 프록시의 body 변경
     */
    protected void setBody(String body) {
        this.body = body;
    }

    /**
     * updatedAt 조회
     */
    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    /**
     * JPA 프록시의 updatedAt 변경
     */
    protected void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}
