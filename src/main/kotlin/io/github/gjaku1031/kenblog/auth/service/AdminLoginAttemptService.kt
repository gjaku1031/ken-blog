package io.github.gjaku1031.kenblog.auth.service

import io.github.gjaku1031.kenblog.account.domain.UserRole
import io.github.gjaku1031.kenblog.account.repository.AccountRepository
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.Locale
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 단일 DB 행 잠금 안에서 관리자 MFA·재사용 방지·로그인 실패 제한을 처리. */
@Service
class AdminLoginAttemptService(
    private val jdbc: JdbcTemplate,
    private val accounts: AccountRepository,
    private val encoder: PasswordEncoder,
    private val settings: AdminMfaSettings,
) : ApplicationRunner {
    /** 재시작 시 설정 회전을 DB 버전에 기록하여 옛 세션을 영구 무효화. */
    @Transactional
    override fun run(args: ApplicationArguments) {
        synchronizeSettings(lockedState(), settings.configured())
    }

    /** 실패 상태도 커밋되도록 예외 대신 결과를 반환하고 MFA 성공 때만 인증 증명을 생성. */
    @Transactional
    fun attempt(password: String, verificationCode: String?): AdminLoginResult {
        val state = lockedState()
        val config = settings.configured()
        synchronizeSettings(state, config)
        val now = Instant.now()
        if (state.lockedUntil?.isAfter(now) == true) return AdminLoginResult.Locked

        val account = config?.let { accounts.findByUsername(it.username) }
        val validPassword = account != null && password.isNotEmpty() &&
            password.toByteArray(Charsets.UTF_8).size <= 72 && encoder.matches(password, account.passwordHash)
        val validOwner = account?.enabled == true && account.role == UserRole.ADMIN
        val step = if (validPassword && validOwner && config != null) matchingTotpStep(config, verificationCode, now) else null
        val recoveryHash = if (validPassword && validOwner && config != null && step == null) {
            matchingRecoveryHash(config, verificationCode)
        } else null
        val recoveryAvailable = recoveryHash != null && jdbc.queryForObject(
            "SELECT COUNT(*) FROM admin_recovery_codes WHERE code_hash = ? AND consumed_at IS NULL",
            Int::class.java, recoveryHash,
        ) == 1
        val unusedTotp = step != null && (state.lastTotpStep == null || step > state.lastTotpStep)

        if (validPassword && validOwner && config != null && (unusedTotp || recoveryAvailable)) {
            if (unusedTotp) jdbc.update("UPDATE admin_auth_state SET last_totp_step = ? WHERE id = 1", step)
            if (recoveryAvailable) jdbc.update(
                "UPDATE admin_recovery_codes SET consumed_at = UTC_TIMESTAMP(6) WHERE code_hash = ? AND consumed_at IS NULL",
                recoveryHash,
            )
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

    /** 요청 세션의 MFA 증명과 현재 설정·계정 해시·DB 인증 버전이 일치하는지 검사. */
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
        "SELECT config_fingerprint, auth_version, last_totp_step, failure_count, locked_until FROM admin_auth_state WHERE id = 1 FOR UPDATE",
        { rs, _ ->
            AuthState(
                rs.getString(1), rs.getLong(2), rs.getLong(3).takeUnless { rs.wasNull() },
                rs.getInt(4), rs.getTimestamp(5)?.toLocalDateTime()?.toInstant(ZoneOffset.UTC),
            )
        },
    ) ?: error("Admin authentication state is missing")

    /** 설정 변경마다 버전을 올리고 복구코드 소비 이력은 덮어쓰지 않고 보존. */
    private fun synchronizeSettings(state: AuthState, config: ConfiguredAdminMfa?) {
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
        config?.recoveryCodeHashes?.forEach { hash ->
            jdbc.update("INSERT IGNORE INTO admin_recovery_codes (code_hash) VALUES (?)", hash)
        }
    }

    /** RFC 6238의 30초 HMAC-SHA1 코드를 앞뒤 한 단계까지 확인. */
    private fun matchingTotpStep(config: ConfiguredAdminMfa, code: String?, now: Instant): Long? {
        if (code == null || !TOTP_PATTERN.matches(code)) return null
        val current = now.epochSecond / 30
        for (step in (current + 1) downTo (current - 1)) {
            val mac = Mac.getInstance("HmacSHA1")
            mac.init(SecretKeySpec(config.totpSecret, "HmacSHA1"))
            val digest = mac.doFinal(ByteBuffer.allocate(8).putLong(step).array())
            val offset = digest.last().toInt() and 0x0f
            val number = ((digest[offset].toInt() and 0x7f) shl 24) or
                ((digest[offset + 1].toInt() and 0xff) shl 16) or
                ((digest[offset + 2].toInt() and 0xff) shl 8) or
                (digest[offset + 3].toInt() and 0xff)
            val expected = (number % 1_000_000).toString().padStart(6, '0')
            if (MessageDigest.isEqual(code.toByteArray(), expected.toByteArray())) return step
        }
        return null
    }

    /** 표시용 하이픈·공백을 제거하고 설정에 등록된 복구코드 해시만 반환. */
    private fun matchingRecoveryHash(config: ConfiguredAdminMfa, code: String?): String? {
        val normalized = code?.filterNot { it == '-' || it.isWhitespace() }?.uppercase(Locale.ROOT) ?: return null
        if (!RECOVERY_PATTERN.matches(normalized)) return null
        return AdminMfaSettings.sha256(normalized).takeIf { it in config.recoveryCodeHashes }
    }

    /** 현재 MFA 설정과 저장된 비밀번호 해시를 묶어 세션용 비밀 없는 증명을 생성. */
    private fun sessionProof(fingerprint: String, passwordHash: String): String =
        AdminMfaSettings.sha256("admin-session-v1\u0000$fingerprint\u0000$passwordHash")

    /** 잠긴 `admin_auth_state` 행의 필요한 열만 담는 트랜잭션 내부 상태. */
    private class AuthState(
        var fingerprint: String,
        var authVersion: Long,
        val lastTotpStep: Long?,
        var failureCount: Int,
        var lockedUntil: Instant?,
    )

    private companion object {
        const val UNCONFIGURED_FINGERPRINT = "0000000000000000000000000000000000000000000000000000000000000000"
        const val MAX_FAILURES = 5
        const val LOCK_SECONDS = 60L
        val TOTP_PATTERN = Regex("[0-9]{6}")
        val RECOVERY_PATTERN = Regex("[0-9A-F]{32}")
    }
}

/** 트랜잭션이 커밋된 뒤 HTTP 인증·잠금 응답을 선택하는 결과. */
sealed interface AdminLoginResult {
    /** 비밀번호와 두 번째 요소를 모두 검증한 인증 결과. */
    data class Success(val username: String, val proof: String, val version: Long) : AdminLoginResult
    /** 잘못된 자격 증명 또는 불완전한 서버 설정. */
    data object Denied : AdminLoginResult
    /** 공유된 로그인 실패 한도에 도달했거나 잠금 중임. */
    data object Locked : AdminLoginResult
}
