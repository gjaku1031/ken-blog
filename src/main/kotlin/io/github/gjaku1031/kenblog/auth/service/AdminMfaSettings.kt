package io.github.gjaku1031.kenblog.auth.service

import java.security.MessageDigest
import java.util.Locale
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component

/** 외부 관리자 MFA 설정을 검증하고 세션에 원문 비밀을 남기지 않는 지문을 계산. */
@Component
class AdminMfaSettings(
    @Value("\${app.auth.admin.username:}") private val username: String,
    @Value("\${app.auth.admin.totp-secret:}") private val totpSecret: String,
    @Value("\${app.auth.admin.recovery-code-hashes:}") private val recoveryCodeHashes: String,
) {
    /** 세 값 모두 올바를 때만 사용 가능한 설정을 반환하며, 누락·오류는 로그인 실패로 처리. */
    fun configured(): ConfiguredAdminMfa? {
        if (!USERNAME_PATTERN.matches(username) || !TOTP_SECRET_PATTERN.matches(totpSecret)) return null
        val hashes = recoveryCodeHashes.split(',').map { it.trim().lowercase(Locale.ROOT) }
        if (hashes.isEmpty() || hashes.any { !HASH_PATTERN.matches(it) } || hashes.size != hashes.toSet().size) return null
        val secretBytes = decodeBase32(totpSecret) ?: return null
        if (secretBytes.size != 20) return null
        val fingerprint = sha256("admin-mfa-v1\u0000$username\u0000$totpSecret\u0000${hashes.sorted().joinToString(",")}")
        return ConfiguredAdminMfa(username, secretBytes, hashes.toSet(), fingerprint)
    }

    /** 정확히 5비트씩 읽어 패딩 없는 160비트 Base32 비밀을 바이트로 변환. */
    private fun decodeBase32(value: String): ByteArray? {
        val result = ByteArray(value.length * 5 / 8)
        var accumulator = 0
        var bits = 0
        var output = 0
        for (character in value) {
            val digit = BASE32_ALPHABET.indexOf(character)
            if (digit < 0) return null
            accumulator = (accumulator shl 5) or digit
            bits += 5
            if (bits >= 8) {
                bits -= 8
                result[output++] = (accumulator ushr bits).toByte()
                accumulator = accumulator and ((1 shl bits) - 1)
            }
        }
        return if (bits == 0 && output == result.size) result else null
    }

    companion object {
        private const val BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        private val USERNAME_PATTERN = Regex("[a-z][a-z0-9_-]{2,63}")
        private val TOTP_SECRET_PATTERN = Regex("[A-Z2-7]{32}")
        private val HASH_PATTERN = Regex("[0-9a-f]{64}")

        /** 원문을 저장하지 않는 SHA-256 소문자 16진수 표현. */
        fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }
}

/** 검증된 단일 관리자 설정. 비밀 바이트는 응답·세션에 기록하지 않음. */
class ConfiguredAdminMfa(
    val username: String,
    val totpSecret: ByteArray,
    val recoveryCodeHashes: Set<String>,
    val fingerprint: String,
)
