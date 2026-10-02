package io.github.gjaku1031.kenblog.post.repository

import io.github.gjaku1031.kenblog.post.domain.PostEntity
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** JPA로 글 저장·단건 조회·변경 잠금만 담당. 목록·검색은 PostQueries에 위임. */
interface PostRepository : JpaRepository<PostEntity, Long> {
    fun existsBySeriesId(seriesId: Long): Boolean

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PostEntity p where p.id = :id")
    fun findLockedById(@Param("id") id: Long): PostEntity?

    @Modifying(flushAutomatically = true)
    @Query("update PostEntity p set p.categoryId = :parentId where p.categoryId in :categoryIds")
    fun moveCategories(@Param("categoryIds") categoryIds: Collection<Long>, @Param("parentId") parentId: Long?): Int
}
