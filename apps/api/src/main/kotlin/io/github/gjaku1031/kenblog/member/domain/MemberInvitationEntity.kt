package io.github.gjaku1031.kenblog.member.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime

/** 원문 토큰 없이 SHA-256 해시만 보관하는 일회용 회원 초대. */
@Entity
@Table(name = "member_invitations")
class MemberInvitationEntity protected constructor() {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(name = "user_id", nullable = false, unique = true)
    var userId: Long = 0
        protected set

    @Column(name = "token_hash", nullable = false, length = 64, unique = true)
    lateinit var tokenHash: String
        protected set

    @Column(name = "expires_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var expiresAt: LocalDateTime
        protected set

    @Column(name = "issued_at", columnDefinition = "datetime(6)")
    var issuedAt: LocalDateTime? = null
        protected set

    @Column(name = "consumed_at", columnDefinition = "datetime(6)")
    var consumedAt: LocalDateTime? = null
        protected set

    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var createdAt: LocalDateTime
        protected set

    /** 회원 ID와 원문을 복구할 수 없는 토큰 해시로 초대 행을 생성. */
    constructor(userId: Long, tokenHash: String, createdAt: LocalDateTime) : this() {
        this.userId = userId
        this.tokenHash = tokenHash
        this.createdAt = createdAt
        expiresAt = createdAt.plusHours(72)
    }

    /** [issuedAt]에 관리자가 일회성 URL을 발급한 시점을 기록. */
    fun markIssued(now: LocalDateTime) { issuedAt = now }

    /** 비밀번호 설정 후 토큰 재사용을 차단. */
    fun consume(now: LocalDateTime) { consumedAt = now }
}
