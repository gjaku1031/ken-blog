package io.github.gjaku1031.kenblog.post.domain;

import io.github.gjaku1031.kenblog.category.domain.CategoryEntity;
import io.github.gjaku1031.kenblog.series.domain.SeriesEntity;

import jakarta.persistence.*;

import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

import java.time.LocalDateTime;

/**
 * Tech·프로젝트·공부를 같은 글 모델로 저장하고 시리즈 소속으로 탐색 구획 결정
 */
@Entity
@Table(
        name = "posts",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uk_posts_slug",
                    columnNames = {"slug"})
        })
public class PostEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected PostEntity() {}

    /**
     * 분류 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "category_id", insertable = false, updatable = false)
    private CategoryEntity category = null;

    /**
     * 시리즈 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "series_id", insertable = false, updatable = false)
    private SeriesEntity series = null;

    /**
     * 관련 프로젝트 시리즈 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "related_series_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.SET_NULL)
    private SeriesEntity relatedSeries = null;

    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id = null;

    /**
     * 제목
     */
    @Column(nullable = false, length = 200)
    private String title;

    /**
     * 공개 주소 식별자
     */
    @Column(
            nullable = false,
            length = 160,
            columnDefinition = "varchar(160) character set ascii collate ascii_bin")
    private String slug;

    /**
     * 요약
     */
    @Column(nullable = false, length = 120)
    private String summary = "";

    /**
     * 분류 ID
     */
    @Column(name = "category_id")
    private Long categoryId = null;

    /**
     * 시리즈 ID
     */
    @Column(name = "series_id")
    private Long seriesId = null;

    /**
     * 관련 프로젝트 시리즈 ID
     */
    @Column(name = "related_series_id")
    private Long relatedSeriesId = null;

    /**
     * 시리즈 내 정렬 순서
     */
    @Column(name = "series_order")
    private Integer seriesOrder = null;

    /**
     * 이전 공개 경로
     */
    @Column(name = "legacy_path", length = 500)
    private String legacyPath = null;

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
     * 관리자 편집 충돌 검사용 버전, 편집 저장·발행 전환·분류 일괄 이동에서 증가
     */
    @Column(name = "edit_version", nullable = false)
    private long editVersion = 0L;

    /**
     * 글 쓰기 잠금을 가진 트랜잭션에서 편집 버전과 수정 시각 갱신
     */
    public void advanceEdit(LocalDateTime now) {
        editVersion = Math.addExact(editVersion, 1);
        updatedAt = now;
    }

    /**
     * 출간 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, columnDefinition = "varchar(16)")
    private PostStatus status = PostStatus.DRAFT;

    /**
     * 최초 출간 시각
     */
    @Column(name = "published_at", columnDefinition = "datetime(6)")
    private LocalDateTime publishedAt = null;

    /**
     * 게시글 초기 메타데이터 설정
     */
    public PostEntity(String title, String slug, LocalDateTime now) {
        this.title = title;
        this.slug = slug;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * 제목·요약과 수정 시각 변경
     */
    public void replaceMetadata(String title, String summary, LocalDateTime now) {
        this.title = title;
        this.summary = summary;
        this.updatedAt = now;
    }

    /**
     * 분류와 수정 시각 변경
     */
    public void changeCategory(Long id, LocalDateTime now) {
        categoryId = id;
        updatedAt = now;
    }

    /**
     * 시리즈 소속·순서·관련 프로젝트 변경
     */
    public void assignSeries(Long id, Integer order, Long relatedId, LocalDateTime now) {
        seriesId = id;
        seriesOrder = order;
        relatedSeriesId = relatedId;
        updatedAt = now;
    }

    /**
     * 출간으로 전환하고 최초 출간 시각 기록
     */
    public void publish(LocalDateTime now) {
        if (status == PostStatus.PUBLISHED) return;
        if (publishedAt == null) publishedAt = now;
        status = PostStatus.PUBLISHED;
        updatedAt = now;
    }

    /**
     * 초안으로 전환하고 수정 시각 갱신
     */
    public void unpublish(LocalDateTime now) {
        if (status == PostStatus.DRAFT) return;
        status = PostStatus.DRAFT;
        updatedAt = now;
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
     * title 조회
     */
    public String getTitle() {
        return title;
    }

    /**
     * JPA 프록시의 title 변경
     */
    protected void setTitle(String title) {
        this.title = title;
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
     * summary 조회
     */
    public String getSummary() {
        return summary;
    }

    /**
     * JPA 프록시의 summary 변경
     */
    protected void setSummary(String summary) {
        this.summary = summary;
    }

    /**
     * categoryId 조회
     */
    public Long getCategoryId() {
        return categoryId;
    }

    /**
     * JPA 프록시의 categoryId 변경
     */
    protected void setCategoryId(Long categoryId) {
        this.categoryId = categoryId;
    }

    /**
     * seriesId 조회
     */
    public Long getSeriesId() {
        return seriesId;
    }

    /**
     * JPA 프록시의 seriesId 변경
     */
    protected void setSeriesId(Long seriesId) {
        this.seriesId = seriesId;
    }

    /**
     * relatedSeriesId 조회
     */
    public Long getRelatedSeriesId() {
        return relatedSeriesId;
    }

    /**
     * JPA 프록시의 relatedSeriesId 변경
     */
    protected void setRelatedSeriesId(Long relatedSeriesId) {
        this.relatedSeriesId = relatedSeriesId;
    }

    /**
     * seriesOrder 조회
     */
    public Integer getSeriesOrder() {
        return seriesOrder;
    }

    /**
     * JPA 프록시의 seriesOrder 변경
     */
    protected void setSeriesOrder(Integer seriesOrder) {
        this.seriesOrder = seriesOrder;
    }

    /**
     * legacyPath 조회
     */
    public String getLegacyPath() {
        return legacyPath;
    }

    /**
     * JPA 프록시의 legacyPath 변경
     */
    protected void setLegacyPath(String legacyPath) {
        this.legacyPath = legacyPath;
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
     * editVersion 조회
     */
    public long getEditVersion() {
        return editVersion;
    }

    /**
     * JPA 프록시의 editVersion 변경
     */
    protected void setEditVersion(long editVersion) {
        this.editVersion = editVersion;
    }

    /**
     * status 조회
     */
    public PostStatus getStatus() {
        return status;
    }

    /**
     * JPA 프록시의 status 변경
     */
    protected void setStatus(PostStatus status) {
        this.status = status;
    }

    /**
     * publishedAt 조회
     */
    public LocalDateTime getPublishedAt() {
        return publishedAt;
    }

    /**
     * JPA 프록시의 publishedAt 변경
     */
    protected void setPublishedAt(LocalDateTime publishedAt) {
        this.publishedAt = publishedAt;
    }
}
