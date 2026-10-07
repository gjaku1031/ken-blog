package io.github.gjaku1031.kenblog.stack.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.Objects;

/**
 * 프로젝트와 기술 뱃지의 복합 키
 */
@Embeddable
public final class SeriesStackBadgeId implements Serializable {
    /**
     * 시리즈 ID
     */
    @Column(name = "series_id")
    private long seriesId;

    /**
     * 기술 뱃지 ID
     */
    @Column(name = "badge_id")
    private long badgeId;

    /**
     * JPA 복합 키 초기화
     */
    protected SeriesStackBadgeId() {}

    /**
     * 연결 식별자 초기화
     */
    public SeriesStackBadgeId(long seriesId, long badgeId) {
        this.seriesId = seriesId;
        this.badgeId = badgeId;
    }

    /**
     * seriesId 조회
     */
    public long getSeriesId() {
        return seriesId;
    }

    /**
     * badgeId 조회
     */
    public long getBadgeId() {
        return badgeId;
    }

    /**
     * 복합 키 값 비교
     */
    @Override
    public boolean equals(Object other) {
        return other instanceof SeriesStackBadgeId key
                && seriesId == key.seriesId
                && badgeId == key.badgeId;
    }

    /**
     * 복합 키 해시
     */
    @Override
    public int hashCode() {
        return Objects.hash(seriesId, badgeId);
    }
}
