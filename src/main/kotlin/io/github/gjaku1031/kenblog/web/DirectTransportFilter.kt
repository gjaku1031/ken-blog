package io.github.gjaku1031.kenblog.web

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.filter.OncePerRequestFilter
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path

/** Nginx 없이 공개 경로·내부 MCP·HTTP-01 경계를 유지; 인증·CSRF 검사는 기존 Spring Security에 위임. */
class DirectTransportFilter(
    private val httpsPort: Int,
    private val localPort: Int,
    private val acmePort: Int,
    webroot: Path,
) : OncePerRequestFilter() {
    private val challenges = webroot.toAbsolutePath().normalize().resolve(".well-known/acme-challenge")

    /** HTTP 인증서 검증 포트는 앱으로 전달하지 않고, MCP는 실제 내부 HTTP 커넥터에서만 허용. */
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val path = request.requestURI
        response.setHeader("X-Content-Type-Options", "nosniff")
        if (path.contains('%') || path.contains(';') || path.contains('\\') || path.contains("//")) {
            response.status = 404
            return
        }
        if (request.localPort == acmePort) {
            serveChallenge(request, response, path)
            return
        }
        val internal = request.localPort == localPort && !request.isSecure
        if (path == "/mcp" || path.startsWith("/mcp/")) {
            if (!internal) { response.status = 404; return }
            chain.doFilter(request, response)
            return
        }
        if (!internal && (request.localPort != httpsPort || !request.isSecure)) {
            response.status = 404
            return
        }
        if (path == "/" || path == "/ken-blog" || path.startsWith("/ken-blog/")) {
            response.setHeader("Cache-Control", "no-store")
            val suffix = if (path.startsWith("/ken-blog/")) path.removePrefix("/ken-blog/") else ""
            val query = request.queryString?.takeIf { value -> value.none { it == '\r' || it == '\n' } }
            response.sendRedirect(PAGES + suffix + if (query.isNullOrEmpty()) "" else "?$query")
            return
        }
        if (path == "/write" || path.startsWith("/write/") || path == "/admin" || path.startsWith("/admin/")) {
            response.sendRedirect("/manage/")
            return
        }
        val allowed = path == "/manage" || path.startsWith("/manage/") ||
            path.startsWith("/assets/") || path.startsWith("/api/v1/") || path == "/actuator/health"
        if (!allowed) { response.status = 404; return }
        if (!path.startsWith("/assets/")) response.setHeader("Cache-Control", "no-store")
        chain.doFilter(request, response)
    }

    /** 토큰 이름의 일반 파일만 제한된 크기로 반환하고 symlink·경로 이동·인증서 자체는 노출하지 않음. */
    private fun serveChallenge(request: HttpServletRequest, response: HttpServletResponse, path: String) {
        response.setHeader("Cache-Control", "no-store")
        if (request.method !in setOf("GET", "HEAD")) {
            response.setHeader("Allow", "GET, HEAD")
            response.status = 405
            return
        }
        if (!path.startsWith(CHALLENGE_PREFIX)) {
            response.sendRedirect(PAGES)
            return
        }
        val token = path.removePrefix(CHALLENGE_PREFIX)
        if (!token.matches(Regex("[A-Za-z0-9_-]{1,256}"))) { response.status = 404; return }
        val file = challenges.resolve(token)
        val content = runCatching {
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > 4096) null
            else Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS).use { it.readNBytes(4097) }
        }.getOrNull()
        if (content == null || content.size > 4096) { response.status = 404; return }
        response.contentType = "text/plain"
        response.characterEncoding = "US-ASCII"
        response.setContentLength(content.size)
        if (request.method == "GET") response.outputStream.write(content)
    }

    private companion object {
        const val PAGES = "https://gjaku1031.github.io/ken-blog/"
        const val CHALLENGE_PREFIX = "/.well-known/acme-challenge/"
    }
}
