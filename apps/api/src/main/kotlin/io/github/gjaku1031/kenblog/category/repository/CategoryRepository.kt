package io.github.gjaku1031.kenblog.category.repository

import io.github.gjaku1031.kenblog.category.domain.CategoryEntity
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** 분류 FK 행의 경로 조회와 생성·삭제에 필요한 안정된 잠금 순서를 제공. */
interface CategoryRepository : JpaRepository<CategoryEntity, Long> {
    /** @return 정규화된 전체 경로의 행, 없으면 `null`. */
    fun findByPath(path: String): CategoryEntity?

    /** @return 생성 시 부모로 사용하거나 삭제할 경로의 잠긴 행, 없으면 `null`. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CategoryEntity c where c.path = :path")
    fun findLockedByPath(@Param("path") path: String): CategoryEntity?

    /** @return 삭제 대상 ID의 잠긴 행, 없으면 `null`. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CategoryEntity c where c.id = :id")
    fun findLockedById(@Param("id") id: Long): CategoryEntity?

    /** @return taxonomy 할당 전에 존재를 보장하는 공유 잠금 행, 없으면 `null`. */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select c from CategoryEntity c where c.id = :id")
    fun findSharedById(@Param("id") id: Long): CategoryEntity?

    /** @return 대상과 자손을 ID 순서로 잠가 새 FK 참조·자식 생성과 직렬화한 목록. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CategoryEntity c where c.path = :path or c.path like :descendants order by c.id asc")
    fun findSubtreeLocked(@Param("path") path: String, @Param("descendants") descendants: String): List<CategoryEntity>

    /** @return 깊이·경로 순서의 모든 빈 폴더 포함 분류 행. */
    fun findAllByOrderByDepthAscPathAsc(): List<CategoryEntity>
}
