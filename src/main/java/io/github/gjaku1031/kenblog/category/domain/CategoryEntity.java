package io.github.gjaku1031.kenblog.category.domain;

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

/**
 * FK로 부모를 참조하고 정규화 경로를 독립적으로 보존하는 Tech 분류 행
 */
@Entity
@Table(
        name = "categories",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uk_categories_path",
                    columnNames = {"path"}),
        })
public class CategoryEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected CategoryEntity() {}

    // DB 외래 키와 삭제 규칙 저장은 기존 ID 필드를 사용

    /**
     * 부모 분류 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id", insertable = false, updatable = false)
    private CategoryEntity parent = null;

    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id = null;

    /**
     * 부모 분류 ID, 최상위이면 null
     */
    @Column(name = "parent_id")
    private Long parentId = null;

    /**
     * 분류 경로
     */
    @Column(
            nullable = false,
            length = 256,
            columnDefinition = "varchar(256) character set utf8mb4 collate utf8mb4_bin")
    private String path;

    /**
     * 이름
     */
    @Column(nullable = false, length = 60)
    private String name;

    /**
     * 분류 깊이
     */
    @Column(nullable = false)
    private int depth = 0;

    /**
     * 정렬 순서
     */
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    /**
     * 검증·정규화된 새 분류를 FK 부모 아래 생성
     *
     * @param parentId 기존 부모 또는 대분류의 {@code null}
     * @param path 중복되지 않는 전체 경로
     * @param name 표시 이름
     * @param depth 1~2 깊이
     * @param sortOrder 같은 부모의 마지막에 배치할 양수 순서
     */
    public CategoryEntity(Long parentId, String path, String name, int depth, int sortOrder) {
        this.parentId = parentId;
        this.path = path;
        this.name = name;
        this.depth = depth;
        this.sortOrder = sortOrder;
    }

    /**
     * 같은 부모의 숫자 순서만 바꾸며 경로와 자손은 유지
     */
    public void reorder(int order) {
        sortOrder = order;
    }

    /**
     * 표시 이름만 변경하며 기존 경로·부모·글 연결 유지
     */
    public void rename(String displayName) {
        name = displayName;
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
     * parentId 조회
     */
    public Long getParentId() {
        return parentId;
    }

    /**
     * JPA 프록시의 parentId 변경
     */
    protected void setParentId(Long parentId) {
        this.parentId = parentId;
    }

    /**
     * path 조회
     */
    public String getPath() {
        return path;
    }

    /**
     * JPA 프록시의 path 변경
     */
    protected void setPath(String path) {
        this.path = path;
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
     * depth 조회
     */
    public int getDepth() {
        return depth;
    }

    /**
     * JPA 프록시의 depth 변경
     */
    protected void setDepth(int depth) {
        this.depth = depth;
    }

    /**
     * sortOrder 조회
     */
    public int getSortOrder() {
        return sortOrder;
    }

    /**
     * JPA 프록시의 sortOrder 변경
     */
    protected void setSortOrder(int sortOrder) {
        this.sortOrder = sortOrder;
    }
}
