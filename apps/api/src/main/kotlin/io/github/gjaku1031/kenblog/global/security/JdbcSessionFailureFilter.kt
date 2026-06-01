package io.github.gjaku1031.kenblog.global.security

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.sql.SQLException
import java.sql.SQLTransientConnectionException
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.CannotGetJdbcConnectionException
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

/**
 * 예외 원인 체인에서 JDBC 연결·자원 접근 장애만 식별.
 *
 * 제약 위반과 SQL 문법 오류 등은 503으로 잘못 분류하지 않음.
 *
 * @return MySQL 연결을 얻거나 유지하지 못한 경우 `true`
 */
internal fun Throwable.isDatabaseConnectionFailure(): Boolean = generateSequence(this) { it.cause }.any {
    it is CannotGetJdbcConnectionException || it is DataAccessResourceFailureException ||
        it is SQLTransientConnectionException ||
        (it is SQLException && it.sqlState?.startsWith("08") == true)
}
