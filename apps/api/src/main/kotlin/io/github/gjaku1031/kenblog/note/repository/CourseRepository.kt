package io.github.gjaku1031.kenblog.note.repository

import io.github.gjaku1031.kenblog.note.domain.CourseEntity
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** [CourseEntity]의 주소 조회와 부모 우선 잠금을 제공하는 저장소. */
interface CourseRepository : JpaRepository<CourseEntity, Long> {
    /** @return 정확한 slug의 과목 또는 null. */
    fun findBySlug(slug: String): CourseEntity?

    /** @return 출간·삭제를 직렬화할 배타 잠금 과목. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CourseEntity c where c.id = :id")
    fun findLockedById(@Param("id") id: Long): CourseEntity?

    /** @return 회차 편집본 생성 중 삭제를 막는 공유 잠금 과목. */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select c from CourseEntity c where c.id = :id")
    fun findSharedById(@Param("id") id: Long): CourseEntity?

    /** @return 분야 등장 순서를 보존하는 관리자·공개 과목 목록. */
    fun findAllByOrderByCreatedAtAscIdAsc(): List<CourseEntity>
}
