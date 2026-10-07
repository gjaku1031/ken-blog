package io.github.gjaku1031.kenblog.stack.domain;

import io.github.gjaku1031.kenblog.series.domain.SeriesEntity;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;

/**
 * 프로젝트 뱃지 선택 순서를 보존하는 연결 행
 */
@Entity
@Table(
        name = "series_stack_badges",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uk_series_stack_badges_order",
                    columnNames = {"series_id", "sort_order"}),
        })
public class SeriesStackBadgeEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected SeriesStackBadgeEntity() {}

    // DB 외래 키와 삭제 규칙 저장은 기존 ID 필드를 사용

    /**
     * 프로젝트 시리즈 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "series_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private SeriesEntity project = null;

    /**
     * 기술 뱃지 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "badge_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private StackBadgeEntity badge = null;

    /**
     * ID
     */
    @EmbeddedId private SeriesStackBadgeId id;

    /**
     * 정렬 순서
     */
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    /**
     * 프로젝트 ID와 이미 등록된 뱃지 ID를 순서대로 연결
     */
    public SeriesStackBadgeEntity(long seriesId, long badgeId, int sortOrder) {
        id = new SeriesStackBadgeId(seriesId, badgeId);
        this.sortOrder = sortOrder;
    }

    /**
     * id 조회
     */
    public SeriesStackBadgeId getId() {
        return id;
    }

    /**
     * JPA 프록시의 id 변경
     */
    protected void setId(SeriesStackBadgeId id) {
        this.id = id;
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
