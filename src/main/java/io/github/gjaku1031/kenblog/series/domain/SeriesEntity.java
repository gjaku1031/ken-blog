package io.github.gjaku1031.kenblog.series.domain;

import io.github.gjaku1031.kenblog.post.domain.PostVisibility;

import jakarta.persistence.*;

import java.time.LocalDateTime;

/**
 * 대문 FK 없이 출간 글의 저장 순서로 첫 문서를 결정하는 시리즈
 */
@Entity
@Table(
        name = "series",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uk_series_slug",
                    columnNames = {"slug"}),
            @UniqueConstraint(
                    name = "uk_series_legacy",
                    columnNames = {"legacy_source", "legacy_id"}),
        })
public class SeriesEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected SeriesEntity() {}

    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id = null;

    /**
     * 공개 주소 식별자
     */
    @Column(
            nullable = false,
            length = 160,
            columnDefinition = "varchar(160) character set ascii collate ascii_bin")
    private String slug;

    /**
     * 이름
     */
    @Column(nullable = false, length = 200)
    private String name;

    /**
     * 설명
     */
    @Column(nullable = false, length = 1000)
    private String description = "";

    /**
     * 시리즈 종류
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, columnDefinition = "varchar(16)")
    private SeriesKind kind;

    /**
     * 공개 범위
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, columnDefinition = "varchar(16)")
    private PostVisibility visibility = PostVisibility.PUBLIC;

    /**
     * 프로젝트 진행 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "project_status", columnDefinition = "varchar(16)")
    private ProjectStatus projectStatus = null;

    /**
     * 시작 연월
     */
    @Column(name = "start_period", length = 7)
    private String startPeriod = null;

    /**
     * 종료 연월
     */
    @Column(name = "end_period", length = 7)
    private String endPeriod = null;

    /**
     * 정렬 순서
     */
    @Column(name = "sort_order", nullable = false)
    private long sortOrder = 0L;

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

    // 재실행 가능한 기존 자료 이관과 이전 주소 연결에만 사용하는 출처

    /**
     * 이관 전 자료 종류
     */
    @Column(name = "legacy_source", length = 16)
    private String legacySource = null;

    /**
     * 이관 전 ID
     */
    @Column(name = "legacy_id")
    private Long legacyId = null;

    /**
     * 시리즈 초기 속성 설정
     */
    public SeriesEntity(
            String slug,
            SeriesKind kind,
            String name,
            String description,
            ProjectStatus projectStatus,
            String startPeriod,
            String endPeriod,
            LocalDateTime now) {
        this.slug = slug;
        this.kind = kind;
        this.createdAt = now;
        this.name = name;
        this.description = description;
        this.projectStatus = projectStatus;
        this.startPeriod = startPeriod;
        this.endPeriod = endPeriod;
        this.updatedAt = now;
    }

    /**
     * 종류와 공개 주소는 유지하며 시리즈 메타데이터만 변경
     */
    public void replace(
            String name,
            String description,
            ProjectStatus projectStatus,
            String startPeriod,
            String endPeriod,
            LocalDateTime now) {
        this.name = name;
        this.description = description;
        this.projectStatus = projectStatus;
        this.startPeriod = startPeriod;
        this.endPeriod = endPeriod;
        this.updatedAt = now;
    }

    /**
     * 시리즈 카드의 숫자 순서만 변경
     */
    public void reorder(long order) {
        sortOrder = order;
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
     * slug 조회
     */
    public String getSlug() {
        return slug;
    }

    /**
     * JPA 프록시의 slug 변경
     */
    protected void setSlug(String slug) {
        this.slug = slug;
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
     * description 조회
     */
    public String getDescription() {
        return description;
    }

    /**
     * JPA 프록시의 description 변경
     */
    protected void setDescription(String description) {
        this.description = description;
    }

    /**
     * kind 조회
     */
    public SeriesKind getKind() {
        return kind;
    }

    /**
     * JPA 프록시의 kind 변경
     */
    protected void setKind(SeriesKind kind) {
        this.kind = kind;
    }

    /**
     * visibility 조회
     */
    public PostVisibility getVisibility() {
        return visibility;
    }

    /**
     * JPA 프록시의 visibility 변경
     */
    protected void setVisibility(PostVisibility visibility) {
        this.visibility = visibility;
    }

    /**
     * projectStatus 조회
     */
    public ProjectStatus getProjectStatus() {
        return projectStatus;
    }

    /**
     * JPA 프록시의 projectStatus 변경
     */
    protected void setProjectStatus(ProjectStatus projectStatus) {
        this.projectStatus = projectStatus;
    }

    /**
     * startPeriod 조회
     */
    public String getStartPeriod() {
        return startPeriod;
    }

    /**
     * JPA 프록시의 startPeriod 변경
     */
    protected void setStartPeriod(String startPeriod) {
        this.startPeriod = startPeriod;
    }

    /**
     * endPeriod 조회
     */
    public String getEndPeriod() {
        return endPeriod;
    }

    /**
     * JPA 프록시의 endPeriod 변경
     */
    protected void setEndPeriod(String endPeriod) {
        this.endPeriod = endPeriod;
    }

    /**
     * sortOrder 조회
     */
    public long getSortOrder() {
        return sortOrder;
    }

    /**
     * JPA 프록시의 sortOrder 변경
     */
    protected void setSortOrder(long sortOrder) {
        this.sortOrder = sortOrder;
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

    /**
     * legacySource 조회
     */
    public String getLegacySource() {
        return legacySource;
    }

    /**
     * JPA 프록시의 legacySource 변경
     */
    protected void setLegacySource(String legacySource) {
        this.legacySource = legacySource;
    }

    /**
     * legacyId 조회
     */
    public Long getLegacyId() {
        return legacyId;
    }

    /**
     * JPA 프록시의 legacyId 변경
     */
    protected void setLegacyId(Long legacyId) {
        this.legacyId = legacyId;
    }
}
