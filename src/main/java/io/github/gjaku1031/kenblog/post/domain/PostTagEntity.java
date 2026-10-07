package io.github.gjaku1031.kenblog.post.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

/**
 * {TagNames.normalize}의 검색 키와 입력 대소문자를 보존한 표시 이름을 저장하는 FK 행
 */
@Entity
@Table(
        name = "post_tags",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uk_post_tags_position",
                    columnNames = {"post_id", "position"}),
            @UniqueConstraint(
                    name = "uk_post_tags_name",
                    columnNames = {"post_id", "tag_name"}),
        })
public class PostTagEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected PostTagEntity() {}

    // DB 외래 키와 삭제 규칙 저장은 기존 ID 필드를 사용

    /**
     * 게시글 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private PostEntity post = null;

    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id = null;

    /**
     * 게시글 ID
     */
    @Column(name = "post_id", nullable = false)
    private long postId = 0L;

    /**
     * 입력 순서의 0 기반 위치
     */
    @Column(nullable = false)
    private int position = 0;

    /**
     * 이름
     */
    @Column(
            name = "tag_name",
            nullable = false,
            length = 40,
            columnDefinition = "varchar(40) character set utf8mb4 collate utf8mb4_bin")
    private String name;

    /**
     * 표시 이름
     */
    @Column(name = "display_name", nullable = false, length = 40)
    private String displayName;

    /**
     * 검증한 이름을 지정 게시글의 0 기반 위치에 놓음
     *
     * @param postId 잠근 게시글의 ID
     * @param position 정규화·중복 제거 후 위치
     * @param name 첫 입력의 대소문자를 보존한 표시 이름
     */
    public PostTagEntity(long postId, int position, String name) {
        this.postId = postId;
        this.position = position;
        this.name = TagNames.normalize(name);
        this.displayName = name;
    }

    /**
     * id 조회
     */
    public Long getId() {
        return id;
    }

    /**
     * JPA 프록시의 id 변경
     */
    protected void setId(Long id) {
        this.id = id;
    }

    /**
     * postId 조회
     */
    public long getPostId() {
        return postId;
    }

    /**
     * JPA 프록시의 postId 변경
     */
    protected void setPostId(long postId) {
        this.postId = postId;
    }

    /**
     * position 조회
     */
    public int getPosition() {
        return position;
    }

    /**
     * JPA 프록시의 position 변경
     */
    protected void setPosition(int position) {
        this.position = position;
    }

    /**
     * name 조회
     */
    public String getName() {
        return name;
    }

    /**
     * JPA 프록시의 name 변경
     */
    protected void setName(String name) {
        this.name = name;
    }

    /**
     * displayName 조회
     */
    public String getDisplayName() {
        return displayName;
    }

    /**
     * JPA 프록시의 displayName 변경
     */
    protected void setDisplayName(String displayName) {
        this.displayName = displayName;
    }
}
