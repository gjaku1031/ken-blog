package io.github.gjaku1031.kenblog

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.data.redis.RedisConnectionFailureException
import org.springframework.data.redis.RedisSystemException
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/**
 * Redis 세션 필터 바깥에서 연결 장애를 잡아 공개 가능한 HTTP 503으로 변환.
 *
 * Redis가 없을 때 로컬 메모리 세션으로 대체하지 않음. 다른 애플리케이션 오류는
 * 기존 [ApiErrorHandler] 또는 Servlet 처리 흐름에 그대로 전달함.
 *
 * @property writer 내부 연결 정보를 숨기는 [SecurityProblemWriter]
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class RedisSessionFailureFilter(private val writer: SecurityProblemWriter) : OncePerRequestFilter() {
    /**
     * 요청 뒤의 Spring Session Redis 접근 실패만 HTTP 503으로 변환.
     *
     * @param request 현재 HTTP 요청
     * @param response 현재 HTTP 응답
     * @param filterChain 나머지 필터 및 MVC 처리 흐름
     */
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        try {
            filterChain.doFilter(request, response)
        } catch (ex: Exception) {
            if (!ex.hasRedisCause() || response.isCommitted) throw ex
            writer.write(response, HttpStatus.SERVICE_UNAVAILABLE)
        }
    }

    /**
     * 예외 체인에 Redis 연결 실패나 명령 타임아웃이 포함되었는지 확인.
     *
     * @return Redis 세션 저장소 장애면 `true`
     */
    private fun Throwable.hasRedisCause(): Boolean = generateSequence(this) { it.cause }.any {
        it is RedisConnectionFailureException || it is RedisSystemException ||
            it.javaClass.name.startsWith("io.lettuce.core.RedisConnectionException") ||
            it.javaClass.name.startsWith("io.lettuce.core.RedisCommandTimeoutException")
    }
}
