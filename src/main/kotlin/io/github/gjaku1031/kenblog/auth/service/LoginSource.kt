package io.github.gjaku1031.kenblog.auth.service

import jakarta.servlet.http.HttpServletRequest
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.net.InetAddress
import java.security.MessageDigest

/**
 * 명시적 공유 키를 가진 Caddy만 출처 헤더를 전달할 수 있는 로그인 제한 경계
 * 원문 주소는 저장하지 않으며 IPv6는 /64 단위로 묶음
 */
@Component
class LoginSource(
    /**
     * 프록시 전용 공유 키, 빈 값이면 직접 연결 주소만 사용
     */
    @Value("\${app.auth.proxy-key:}") private val proxyKey: String,
) {
    // 짧은 공유 키로 전달 헤더 신뢰를 활성화하지 않음
    init { check(proxyKey.isEmpty() || proxyKey.length >= 32) { "Authentication proxy key is too short" } }

    /**
     * DNS 조회 없이 검증한 숫자 주소를 익명 출처 키로 변환
     */
    fun key(request: HttpServletRequest): String {
        val supplied = request.getHeader("X-Ken-Blog-Proxy-Key").orEmpty()
        val trusted = proxyKey.isNotEmpty() && MessageDigest.isEqual(proxyKey.toByteArray(), supplied.toByteArray())
        val forwarded = if (trusted) request.getHeader("X-Ken-Blog-Client-IP") else null
        val raw = forwarded?.takeIf { it.length <= 45 && it.matches(Regex("[0-9a-fA-F:.]+")) } ?: request.remoteAddr
        val bytes = try { InetAddress.getByName(raw).address } catch (_: java.net.UnknownHostException) { byteArrayOf() }
        val network = if (bytes.size == 16) bytes.copyOfRange(0, 8) else bytes
        return AdminAuthSettings.sha256("login-source-v1:" + java.util.HexFormat.of().formatHex(network))
    }
}
