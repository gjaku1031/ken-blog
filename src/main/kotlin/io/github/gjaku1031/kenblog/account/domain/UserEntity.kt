package io.github.gjaku1031.kenblog.account.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import java.time.LocalDateTime
import org.hibernate.annotations.ColumnDefault

/**
 * [UserEntity.role]에 저장하는 계정 권한
 * 로그인은 설정된 활성 ADMIN 계정으로 제한
 */
enum class UserRole {
    /**
     * 관리자
     */
    ADMIN,

    /**
     * 일반 사용자
     */
    USER
}

/**
 * `users` 행에 대응하는 인증 계정
 *
 * [passwordHash]는 `{bcrypt}` 접두사가 있는 해시이며 평문 비밀번호를 저장하지 않음
 *
 * 생성 시각은 UTC [LocalDateTime]으로 기록함
 */
@Entity
@Table(name = "users", uniqueConstraints = [
    UniqueConstraint(name = "uk_users_username", columnNames = ["username"]),
])
open class UserEntity protected constructor() {
    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    open var id: Long? = null
        protected set

    /**
     * 계정명
     */
    @Column(nullable = false, length = 64, columnDefinition = "varchar(64) character set ascii collate ascii_bin")
    open lateinit var username: String
        protected set

    /**
     * 비밀번호 해시
     */
    @Column(name = "password_hash", nullable = false, length = 100)
    open lateinit var passwordHash: String
        protected set

    /**
     * 계정 권한
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    open lateinit var role: UserRole
        protected set

    /**
     * 생성 시각
     */
    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    open lateinit var createdAt: LocalDateTime
        protected set

    /**
     * 표시 이름
     */
    @Column(name = "display_name", length = 100)
    open var displayName: String? = null
        protected set

    /**
     * 계정 활성 여부
     */
    @ColumnDefault("true")
    @Column(nullable = false)
    open var enabled: Boolean = true
        protected set
}
