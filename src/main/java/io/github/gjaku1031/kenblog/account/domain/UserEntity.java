package io.github.gjaku1031.kenblog.account.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import org.hibernate.annotations.ColumnDefault;

import java.time.LocalDateTime;

/**
 * {@code users} 행에 대응하는 인증 계정
 *
 * {passwordHash}는 {@code {bcrypt}} 접두사가 있는 해시이며 평문 비밀번호를 저장하지 않음
 *
 * 생성 시각은 UTC {LocalDateTime}으로 기록함
 */
@Entity
@Table(
        name = "users",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uk_users_username",
                    columnNames = {"username"}),
        })
public class UserEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected UserEntity() {}

    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id = null;

    /**
     * 계정명
     */
    @Column(
            nullable = false,
            length = 64,
            columnDefinition = "varchar(64) character set ascii collate ascii_bin")
    private String username;

    /**
     * 비밀번호 해시
     */
    @Column(name = "password_hash", nullable = false, length = 100)
    private String passwordHash;

    /**
     * 계정 권한
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private UserRole role;

    /**
     * 생성 시각
     */
    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    private LocalDateTime createdAt;

    /**
     * 표시 이름
     */
    @Column(name = "display_name", length = 100)
    private String displayName = null;

    /**
     * 계정 활성 여부
     */
    @ColumnDefault("true")
    @Column(nullable = false)
    private boolean enabled = true;

    /**
     * id 조회
     */
    public Long getId() {
        return id;
    }

    /**
     * JPA 프록시의 id 변경
     */
    protected void setId(Long id) {
        this.id = id;
    }

    /**
     * username 조회
     */
    public String getUsername() {
        return username;
    }

    /**
     * JPA 프록시의 username 변경
     */
    protected void setUsername(String username) {
        this.username = username;
    }

    /**
     * passwordHash 조회
     */
    public String getPasswordHash() {
        return passwordHash;
    }

    /**
     * JPA 프록시의 passwordHash 변경
     */
    protected void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    /**
     * role 조회
     */
    public UserRole getRole() {
        return role;
    }

    /**
     * JPA 프록시의 role 변경
     */
    protected void setRole(UserRole role) {
        this.role = role;
    }

    /**
     * createdAt 조회
     */
    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    /**
     * JPA 프록시의 createdAt 변경
     */
    protected void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    /**
     * displayName 조회
     */
    public String getDisplayName() {
        return displayName;
    }

    /**
     * JPA 프록시의 displayName 변경
     */
    protected void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    /**
     * enabled 조회
     */
    public boolean getEnabled() {
        return enabled;
    }

    /**
     * JPA 프록시의 enabled 변경
     */
    protected void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }
}
