package io.github.gjaku1031.kenblog.mcp.transport

import io.github.gjaku1031.kenblog.global.security.SecurityProblemWriter
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpStatus
import org.springframework.web.filter.OncePerRequestFilter
import java.net.InetAddress
import java.util.Collections

/**
 * MCP 요청을 명시된 VM 내부 소켓 주소와 loopback Host에 한정.
 *
 * Docker의 호스트 127.0.0.1 publish는 컨테이너에 정확한 gateway IP로 도착하므로,
 * [allowedPeersCsv]에는 운영 bridge의 gateway IP 한 개만 추가.
 */
class McpLocalAccessFilter(
    private val enabled: Boolean,
    allowedPeersCsv: String,
    allowedHostsCsv: String,
    private val problemWriter: SecurityProblemWriter,
) : OncePerRequestFilter() {
    private val allowedPeers = allowedPeersCsv.split(',').map(String::trim).filter(String::isNotEmpty)
        .map(::literalAddress).toSet()
    private val allowedHosts = allowedHostsCsv.split(',').map(String::trim).filter(String::isNotEmpty).toSet()

    init {
        check(allowedPeers.isNotEmpty()) { "MCP peers must be explicit IP literals" }
        check(allowedHosts.isNotEmpty() && allowedHosts.all(::isLoopbackHost)) {
            "MCP hosts must be explicit loopback hosts with ports"
        }
    }

    /**
     * [HttpServletRequest.remoteAddr]와 Host를 검사하고 브라우저 Origin 및 프록시 헤더를 거절.
     *
     * 인증 없는 MCP 경로이므로 전달 헤더나 일반 웹 세션의 신뢰 범위를 재사용하지 않음.
     */
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        if (!enabled) {
            problemWriter.write(response, HttpStatus.NOT_FOUND)
            return
        }
        val hosts = Collections.list(request.getHeaders("Host"))
        val remote = runCatching { literalAddress(request.remoteAddr) }.getOrNull()
        val hasForwardingHeader = Collections.list(request.headerNames).any { header ->
            header.equals("Origin", ignoreCase = true) ||
                header.equals("Referer", ignoreCase = true) ||
                header.startsWith("Sec-Fetch-", ignoreCase = true) ||
                header.equals("Forwarded", ignoreCase = true) ||
                header.startsWith("X-Forwarded-", ignoreCase = true) ||
                header.equals("X-Real-IP", ignoreCase = true) ||
                header.equals("X-Original-URL", ignoreCase = true) ||
                header.equals("X-Rewrite-URL", ignoreCase = true)
        }
        if (remote == null || remote !in allowedPeers || hosts.size != 1 || hosts.single() !in allowedHosts ||
            hasForwardingHeader
        ) {
            problemWriter.write(response, HttpStatus.FORBIDDEN)
            return
        }
        filterChain.doFilter(request, response)
    }

    /** [literalAddress]가 DNS 조회로 설정을 넓히지 않도록 IP 문자만 허용. */
    private fun literalAddress(value: String): InetAddress {
        val ipv4 = value.matches(Regex("[0-9]+(?:\\.[0-9]+){3}")) &&
            value.split('.').all { (it.toIntOrNull() ?: -1) in 0..255 }
        val ipv6 = ':' in value && value.matches(Regex("[0-9A-Fa-f:.]+"))
        check(ipv4 || ipv6) { "MCP peers must be IP literals" }
        return InetAddress.getByName(value)
    }

    /** 허용 Host는 선택한 포트의 loopback 이름만 사용. */
    private fun isLoopbackHost(value: String): Boolean {
        val match = Regex("(127\\.0\\.0\\.1|localhost|\\[::1])[:]([0-9]{1,5})").matchEntire(value) ?: return false
        return (match.groupValues[2].toIntOrNull() ?: -1) in 1..65535
    }
}
