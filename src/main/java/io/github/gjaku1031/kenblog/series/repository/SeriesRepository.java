package io.github.gjaku1031.kenblog.series.repository;

import io.github.gjaku1031.kenblog.series.domain.SeriesEntity;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 시리즈의 저장과 변경 경합을 직렬화하는 행 잠금
 * 복잡한 읽기는 jOOQ로 수행
 */
public interface SeriesRepository extends JpaRepository<SeriesEntity, Long> {
    /**
     * ID로 조회하며 변경용 배타 잠금 취득
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from SeriesEntity s where s.id = :id")
    SeriesEntity findLockedById(@Param("id") long id);
}
