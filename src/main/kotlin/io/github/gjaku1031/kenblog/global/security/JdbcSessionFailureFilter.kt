package io.github.gjaku1031.kenblog.global.security

import io.github.gjaku1031.kenblog.global.error.isDatabaseConnectionFailure
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/**
 * MVC 바깥의 Spring Session JDBC 연결 실패를 공개 가능한 HTTP 503으로 변환.
 *
 * DB가 없을 때 로컬 메모리 세션으로 대체하지 않으며 무결성 오류 등은 원래 경계로 전달.
 *
 * @property writer 내부 연결 정보를 숨기는 [SecurityProblemWriter]
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class JdbcSessionFailureFilter(private val writer: SecurityProblemWriter) : OncePerRequestFilter() {
    /**
     * 뒤따르는 세션 필터의 DB 연결 실패만 HTTP 503으로 변환.
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
            if (!ex.isDatabaseConnectionFailure() || response.isCommitted) throw ex
            writer.write(response, HttpStatus.SERVICE_UNAVAILABLE)
        }
    }
}
