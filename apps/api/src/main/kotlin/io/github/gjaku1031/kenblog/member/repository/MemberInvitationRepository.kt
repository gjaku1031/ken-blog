package io.github.gjaku1031.kenblog.member.repository

import io.github.gjaku1031.kenblog.member.domain.MemberInvitationEntity
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** [MemberInvitationEntity]의 토큰·회원 조회와 완료 직렬화. */
interface MemberInvitationRepository : JpaRepository<MemberInvitationEntity, Long> {
    /** @return SHA-256 해시에 일치하는 초대 또는 `null`. */
    fun findByTokenHash(tokenHash: String): MemberInvitationEntity?

    /** @return 회원에게 발급한 초대 또는 `null`. */
    fun findByUserId(userId: Long): MemberInvitationEntity?

    /** @return 완료 경쟁을 직렬화한 초대 또는 `null`. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from MemberInvitationEntity i where i.tokenHash = :hash")
    fun findLockedByTokenHash(@Param("hash") hash: String): MemberInvitationEntity?
}
