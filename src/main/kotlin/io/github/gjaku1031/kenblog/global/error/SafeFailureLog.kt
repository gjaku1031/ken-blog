package io.github.gjaku1031.kenblog.global.error

import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.web.servlet.HandlerMapping
import java.util.UUID

/**
 * 입력·SQL·예외 메시지 없이 서버 장애의 위치와 연관 ID만 기록
 */
@Component
class SafeFailureLog {
    /**
     * 장애 전용 로그 채널
     */
    private val log = LoggerFactory.getLogger(SafeFailureLog::class.java)

    /**
     * 요청마다 한 번만 기록하고 응답과 연결할 장애 ID 반환
     * 원인 타입 최대 4개·애플리케이션 프레임 최대 8개로 제한
     */
    fun record(request: HttpServletRequest, failure: Throwable): String {
        val existing = request.getAttribute("kenblog.failure-id") as? String
        if (existing != null) return existing
        val id = UUID.randomUUID().toString()
        request.setAttribute("kenblog.failure-id", id)
        val method = request.method.takeIf { it in setOf("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS") } ?: "OTHER"
        val route = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE)?.toString() ?: "unmapped"
        val causes = generateSequence(failure) { it.cause }.take(4).toList()
        val frames = causes.flatMap { it.stackTrace.toList() }.filter { it.className.startsWith("io.github.gjaku1031.kenblog.") }
            .take(8).joinToString(";") { "${it.className}.${it.methodName}:${it.lineNumber}" }
        log.error("API failure id={} method={} route={} types={} frames={}", id, method, route,
            causes.joinToString(",") { it.javaClass.name }, frames)
        return id
    }
}
