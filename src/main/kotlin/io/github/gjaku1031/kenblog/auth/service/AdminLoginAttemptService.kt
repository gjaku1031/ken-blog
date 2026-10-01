package io.github.gjaku1031.kenblog.auth.service

import io.github.gjaku1031.kenblog.account.domain.UserRole
import io.github.gjaku1031.kenblog.account.repository.AccountRepository
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 단일 DB 행 잠금 안에서 관리자 비밀번호와 로그인 실패 제한을 처리. */
@Service
class AdminLoginAttemptService(
    private val jdbc: JdbcTemplate,
    private val accounts: AccountRepository,
    private val encoder: PasswordEncoder,
    private val settings: AdminAuthSettings,
) : ApplicationRunner {
    /** 재시작 시 설정 회전을 DB 버전에 기록하여 옛 세션을 영구 무효화. */
    @Transactional
    override fun run(args: ApplicationArguments) {
        synchronizeSettings(lockedState(), settings.configured())
    }

    /** 실패 상태도 커밋되도록 예외 대신 결과를 반환하고 비밀번호 인증 성공 때만 인증 증명을 생성. */
    @Transactional
    fun attempt(password: String): AdminLoginResult {
        val state = lockedState()
        val config = settings.configured()
        synchronizeSettings(state, config)
        val now = Instant.now()
        if (state.lockedUntil?.isAfter(now) == true) return AdminLoginResult.Locked

        val account = config?.let { accounts.findByUsername(it.username) }
        val validPassword = account != null && password.isNotEmpty() &&
            password.toByteArray(Charsets.UTF_8).size <= 72 && encoder.matches(password, account.passwordHash)
        val validOwner = account?.enabled == true && account.role == UserRole.ADMIN
        if (validPassword && validOwner && config != null) {
            jdbc.update("UPDATE admin_auth_state SET failure_count = 0, locked_until = NULL WHERE id = 1")
            return AdminLoginResult.Success(config.username, sessionProof(config.fingerprint, account.passwordHash), state.authVersion)
        }

        val failures = state.failureCount + 1
        if (failures >= MAX_FAILURES) {
            jdbc.update(
                "UPDATE admin_auth_state SET failure_count = 0, locked_until = ? WHERE id = 1",
                LocalDateTime.ofInstant(now.plusSeconds(LOCK_SECONDS), ZoneOffset.UTC),
            )
            return AdminLoginResult.Locked
        }
        jdbc.update("UPDATE admin_auth_state SET failure_count = ? WHERE id = 1", failures)
        return AdminLoginResult.Denied
    }

    /** 요청 세션의 인증 증명과 현재 설정·계정 해시·DB 인증 버전이 일치하는지 검사. */
    fun isValidSession(username: String, passwordHash: String, proof: Any?, version: Any?): Boolean {
        val config = settings.configured() ?: return false
        if (username != config.username || proof !is String || version !is Long) return false
        if (!MessageDigest.isEqual(proof.toByteArray(), sessionProof(config.fingerprint, passwordHash).toByteArray())) return false
        val state = jdbc.queryForObject(
            "SELECT config_fingerprint, auth_version FROM admin_auth_state WHERE id = 1",
            { rs, _ -> rs.getString(1) to rs.getLong(2) },
        ) ?: return false
        return state.first == config.fingerprint && state.second == version
    }

    /** 모든 로그인 시도를 직렬화할 단일 상태 행을 배타적으로 조회. */
    private fun lockedState(): AuthState = jdbc.queryForObject(
        "SELECT config_fingerprint, auth_version, failure_count, locked_until FROM admin_auth_state WHERE id = 1 FOR UPDATE",
        { rs, _ ->
            AuthState(
                rs.getString(1), rs.getLong(2), rs.getInt(3), rs.getTimestamp(4)?.toLocalDateTime()?.toInstant(ZoneOffset.UTC),
            )
        },
    ) ?: error("Admin authentication state is missing")

    /** 설정 변경마다 버전을 올리고 이전 설정의 세션은 무효화. */
    private fun synchronizeSettings(state: AuthState, config: ConfiguredAdminAuth?) {
        val fingerprint = config?.fingerprint ?: UNCONFIGURED_FINGERPRINT
        if (state.fingerprint != fingerprint) {
            jdbc.update(
                "UPDATE admin_auth_state SET config_fingerprint = ?, auth_version = auth_version + 1, failure_count = 0, locked_until = NULL WHERE id = 1",
                fingerprint,
            )
            state.fingerprint = fingerprint
            state.authVersion++
            state.failureCount = 0
            state.lockedUntil = null
        }
    }

    /** 현재 관리자 설정과 저장된 비밀번호 해시를 묶어 세션용 비밀 없는 증명을 생성. */
    private fun sessionProof(fingerprint: String, passwordHash: String): String =
        AdminAuthSettings.sha256("admin-session-v2\u0000$fingerprint\u0000$passwordHash")

    /** 잠긴 `admin_auth_state` 행의 필요한 열만 담는 트랜잭션 내부 상태. */
    private class AuthState(
        var fingerprint: String,
        var authVersion: Long,
        var failureCount: Int,
        var lockedUntil: Instant?,
    )

    private companion object {
        const val UNCONFIGURED_FINGERPRINT = "0000000000000000000000000000000000000000000000000000000000000000"
        const val MAX_FAILURES = 5
        const val LOCK_SECONDS = 60L
    }
}

/** 트랜잭션이 커밋된 뒤 HTTP 인증·잠금 응답을 선택하는 결과. */
sealed interface AdminLoginResult {
    /** 비밀번호를 검증한 인증 결과. */
    data class Success(val username: String, val proof: String, val version: Long) : AdminLoginResult
    /** 잘못된 자격 증명 또는 불완전한 서버 설정. */
    data object Denied : AdminLoginResult
    /** 공유된 로그인 실패 한도에 도달했거나 잠금 중임. */
    data object Locked : AdminLoginResult
}
