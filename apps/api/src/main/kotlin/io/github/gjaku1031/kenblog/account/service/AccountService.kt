package io.github.gjaku1031.kenblog.account.service

import io.github.gjaku1031.kenblog.account.domain.UserEntity
import io.github.gjaku1031.kenblog.account.domain.UserRole
import io.github.gjaku1031.kenblog.account.repository.AccountRepository
import java.time.Clock
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 초기 관리자 계정 준비를 검증하고 [AccountRepository] 쓰기를 트랜잭션으로 묶음.
 *
 * [AccountRepository.count]와 [AccountRepository.findByUsername]으로 기존 계정을 확인하고,
 * 새 계정만 [AccountRepository.saveAndFlush]로 저장함.
 *
 * 공개 회원가입·계정 변경 경로는 제공하지 않음.
 *
 * @property repository 계정 영속 저장소
 */
@Service
class AccountService(private val repository: AccountRepository) {
    /**
     * 두 설정값이 모두 있을 때 빈 DB에 관리자 한 명을 준비.
     *
     * 같은 관리자만 존재하면 재시작 시 저장된 해시를 유지함. 다른 계정이나 동명
     * [UserRole.USER]가 있으면 자동 생성·승격하지 않고 시작을 중단함.
     * 새 [UserEntity]는 null ID로 저장하며 flush는 SQL을 동기화하지만 커밋하지 않음.
     *
     * @param username 외부에서 공급한 관리자 이름; 비어 있으면 해시도 비어 있어야 함
     * @param passwordHash 외부에서 공급한 비용 10~14의 `{bcrypt}` 해시; 평문은 허용하지 않음
     * @throws IllegalStateException 설정 쌍·형식이 잘못되거나 다른 계정이 이미 존재할 때
     */
    @Transactional
    fun ensureInitialAdmin(username: String, passwordHash: String) {
        if (username.isEmpty() && passwordHash.isEmpty()) return
        check(username.isNotEmpty() && passwordHash.isNotEmpty()) { "Initial admin settings must be supplied together" }
        check(USERNAME_PATTERN.matches(username)) { "Initial admin username has an invalid format" }
        check(BCRYPT_PATTERN.matches(passwordHash)) { "Initial admin password hash must be bcrypt encoded with cost 10-14" }

        val count = repository.count()
        if (count > 0) {
            val existing = repository.findByUsername(username)
            check(count == 1L && existing?.role == UserRole.ADMIN) { "Initial admin conflicts with existing accounts" }
            return
        }

        val createdAt = LocalDateTime.ofInstant(Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)
        repository.saveAndFlush(UserEntity(username, passwordHash, UserRole.ADMIN, createdAt))
    }

    private companion object {
        val USERNAME_PATTERN = Regex("[a-z][a-z0-9_-]{2,63}")
        val BCRYPT_PATTERN = Regex("\\{bcrypt\\}\\$2[aby]\\$1[0-4]\\$[./A-Za-z0-9]{53}")
    }
}
