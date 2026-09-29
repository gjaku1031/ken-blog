package io.github.gjaku1031.kenblog.attachment.repository

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentEntity
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/**
 * [AttachmentEntity]의 기본 CRUD와 상태 전환용 행 잠금을 제공하는 Spring Data 저장소.
 *
 * 상속된 [JpaRepository.saveAndFlush]로 짧은 트랜잭션 안에서 상태를 확정함.
 */
interface AttachmentRepository : JpaRepository<AttachmentEntity, Long> {
    /**
     * 같은 첨부의 업로드 완료·삭제 전환을 직렬화하기 위해 행을 잠금.
     *
     * @param id 첨부 식별자
     * @return 잠근 [AttachmentEntity], 없으면 `null`
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from AttachmentEntity a where a.id = :id")
    fun findLockedById(@Param("id") id: Long): AttachmentEntity?
}
