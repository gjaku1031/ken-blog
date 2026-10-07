package io.github.gjaku1031.kenblog.stack.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 로컬 저장소 PNG 객체와 대소문자 무시 고유 이름을 연결하는 기술 뱃지
 */
@Entity
@Table(name = "stack_badges")
public class StackBadgeEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected StackBadgeEntity() {}

    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id = null;

    /**
     * 이름
     */
    @Column(nullable = false, length = 100)
    private String name;

    /**
     * 대소문자를 구분하지 않는 이름 키
     */
    @Column(
            name = "name_key",
            nullable = false,
            length = 100,
            unique = true,
            columnDefinition = "varchar(100) character set utf8mb4 collate utf8mb4_bin")
    private String nameKey;

    /**
     * 저장 루트 기준 객체 경로
     */
    @Column(
            name = "object_key",
            nullable = false,
            length = 255,
            unique = true,
            columnDefinition = "varchar(255) character set ascii collate ascii_bin")
    private String objectKey;

    /**
     * 생성 시각
     */
    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    private LocalDateTime createdAt;

    /**
     * 수정 시각
     */
    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    private LocalDateTime updatedAt;

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
     * nameKey 조회
     */
    public String getNameKey() {
        return nameKey;
    }

    /**
     * JPA 프록시의 nameKey 변경
     */
    protected void setNameKey(String nameKey) {
        this.nameKey = nameKey;
    }

    /**
     * objectKey 조회
     */
    public String getObjectKey() {
        return objectKey;
    }

    /**
     * JPA 프록시의 objectKey 변경
     */
    protected void setObjectKey(String objectKey) {
        this.objectKey = objectKey;
    }

    /**
     * createdAt 조회
     */
    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    /**
     * JPA 프록시의 createdAt 변경
     */
    protected void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
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
