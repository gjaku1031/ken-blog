package io.github.gjaku1031.kenblog.account.domain

import io.github.gjaku1031.kenblog.account.service.AccountService
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime

/** [UserEntity.role]에 저장하는 계정 권한. 현재 자동 준비 대상은 [ADMIN]뿐임. */
enum class UserRole { ADMIN, USER }

/**
 * Flyway V2의 `users` 행에 대응하는 인증 계정.
 *
 * [passwordHash]는 `{bcrypt}` 접두사가 있는 해시이며 평문 비밀번호를 저장하지 않음.
 * 생성 시각은 UTC [LocalDateTime]으로 기록함.
 */
@Entity
@Table(name = "users")
class UserEntity protected constructor() {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(nullable = false, length = 64, unique = true)
    lateinit var username: String
        protected set

    @Column(name = "password_hash", nullable = false, length = 100)
    lateinit var passwordHash: String
        protected set

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    lateinit var role: UserRole
        protected set

    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var createdAt: LocalDateTime
        protected set

    /**
     * 이미 검증된 계정 속성으로 새 저장 객체를 생성.
     *
     * 호출자는 [AccountService.ensureInitialAdmin]에서 초기 관리자 입력을 검증해야 함.
     *
     * @param username 대소문자를 구분하는 ASCII 계정명
     * @param passwordHash `{bcrypt}` 형식의 비밀번호 해시
     * @param role 계정의 [UserRole]
     * @param createdAt UTC 생성 시각
     */
    internal constructor(username: String, passwordHash: String, role: UserRole, createdAt: LocalDateTime) : this() {
        this.username = username
        this.passwordHash = passwordHash
        this.role = role
        this.createdAt = createdAt
    }
}
