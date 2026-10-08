package io.github.gjaku1031.kenblog.post.repository;

import io.github.gjaku1031.kenblog.post.domain.PostEntity;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;

/**
 * JPA로 글 저장·단건 조회·변경 잠금만 담당
 * 목록·집계는 PostQueries에 위임
 */
public interface PostRepository extends JpaRepository<PostEntity, Long> {
    /**
     * 출간 상태와 관계없이 시리즈 소속 또는 관련 글의 존재 확인
     */
    boolean existsBySeriesIdOrRelatedSeriesId(long seriesId, long relatedSeriesId);

    /**
     * ID로 조회하며 변경용 배타 잠금 취득
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PostEntity p where p.id = :id")
    PostEntity findLockedById(@Param("id") long id);

    /**
     * 삭제할 분류의 글을 지정 분류로 이동하고 기존 편집 폼 무효화
     */
    @Modifying(flushAutomatically = true)
    @Query(
            "update PostEntity p set p.categoryId = :parentId, p.editVersion = p.editVersion + 1"
                + " where p.categoryId in :categoryIds")
    int moveCategories(
            @Param("categoryIds") Collection<Long> categoryIds, @Param("parentId") Long parentId);
}
