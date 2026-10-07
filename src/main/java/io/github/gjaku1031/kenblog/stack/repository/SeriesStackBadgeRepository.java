package io.github.gjaku1031.kenblog.stack.repository;

import io.github.gjaku1031.kenblog.stack.domain.SeriesStackBadgeEntity;
import io.github.gjaku1031.kenblog.stack.domain.SeriesStackBadgeId;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

/**
 * {@code SeriesStackBadgeEntity}의 프로젝트별 연결 조회·변경
 */
public interface SeriesStackBadgeRepository
        extends JpaRepository<SeriesStackBadgeEntity, SeriesStackBadgeId> {
    /**
     * 프로젝트에 선택된 뱃지 연결을 저장 순서로 반환
     */
    List<SeriesStackBadgeEntity> findByIdSeriesIdOrderBySortOrder(long seriesId);

    /**
     * 프로젝트 출간 변경 전 기존 선택을 모두 제거
     */
    void deleteByIdSeriesId(long seriesId);
}
