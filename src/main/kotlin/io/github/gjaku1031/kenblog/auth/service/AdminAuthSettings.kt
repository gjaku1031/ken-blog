package io.github.gjaku1031.kenblog.auth.service

import java.security.MessageDigest
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component

/** 서버가 지정한 단일 관리자. 인증 방식 버전으로 이전 세션과 구분. */
@Component
class AdminAuthSettings(@Value("\${app.auth.admin.username:}") private val username: String) {
    fun configured(): ConfiguredAdminAuth? = if (Regex("[a-z][a-z0-9_-]{2,63}").matches(username))
        ConfiguredAdminAuth(username, sha256("admin-password-v2\u0000$username")) else null
    companion object {
        /** 원문을 저장하지 않는 SHA-256 소문자 16진수 표현. */
        fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }
}
class ConfiguredAdminAuth(val username: String, val fingerprint: String)
