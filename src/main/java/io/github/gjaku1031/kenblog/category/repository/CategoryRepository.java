package io.github.gjaku1031.kenblog.category.repository;

import io.github.gjaku1031.kenblog.category.domain.CategoryEntity;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

/**
 * 분류 FK 행의 경로 조회와 생성·삭제에 필요한 안정된 잠금 순서를 제공
 */
public interface CategoryRepository extends JpaRepository<CategoryEntity, Long> {
    /**
     * 생성 시 부모로 사용하거나 삭제할 경로의 잠긴 행, 없으면 {@code null}.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CategoryEntity c where c.path = :path")
    CategoryEntity findLockedByPath(@Param("path") String path);

    /**
     * 삭제 대상 ID의 잠긴 행, 없으면 {@code null}.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CategoryEntity c where c.id = :id")
    CategoryEntity findLockedById(@Param("id") long id);

    /**
     * taxonomy 할당 전에 존재를 보장하는 공유 잠금 행, 없으면 {@code null}.
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select c from CategoryEntity c where c.id = :id")
    CategoryEntity findSharedById(@Param("id") long id);

    /**
     * 대상과 자손을 ID 순서로 잠가 새 FK 참조·자식 생성과 직렬화한 목록
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select c from CategoryEntity c where c.path = :path or c.path like :descendants order"
                + " by c.id asc")
    List<CategoryEntity> findSubtreeLocked(
            @Param("path") String path, @Param("descendants") String descendants);

    /**
     * 같은 부모의 저장 순서를 보존하도록 정렬한 모든 빈 폴더 포함 분류 행
     */
    List<CategoryEntity> findAllByOrderByDepthAscSortOrderAscIdAsc();

    /**
     * 같은 부모의 현재 직계 형제; {@code null}이면 대분류 전체
     */
    @Query(
            "select c from CategoryEntity c where (:parentId is null and c.parentId is null) "
                    + "or c.parentId = :parentId order by c.sortOrder asc, c.id asc")
    List<CategoryEntity> findSiblings(@Param("parentId") Long parentId);
}
