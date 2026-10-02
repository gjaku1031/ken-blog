package io.github.gjaku1031.kenblog.global.error

import java.sql.SQLException
import java.sql.SQLTransientConnectionException
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.dao.PessimisticLockingFailureException
import org.springframework.http.HttpStatus
import org.springframework.http.HttpStatusCode
import org.springframework.jdbc.CannotGetJdbcConnectionException
import org.springframework.security.core.AuthenticationException
import org.springframework.web.ErrorResponse

/** HTTP와 MCP가 공유하는 공개 오류 설명. 프로토콜별 응답 형태·코드는 각 경계에서 처리. */
internal data class PublicError(val status: HttpStatusCode, val detail: String) {
    companion object {
        /** 명시된 업무 실패를 우선하고, 알려지지 않은 내부 예외 원문은 항상 제외. */
        fun from(ex: Exception): PublicError = when {
            ex is BusinessException -> PublicError(ex.status, ex.publicDetail)
            ex is PessimisticLockingFailureException -> PublicError(HttpStatus.CONFLICT, "동시 변경이 충돌했습니다.")
            ex.isDatabaseConnectionFailure() -> PublicError(HttpStatus.SERVICE_UNAVAILABLE, "데이터베이스에 연결할 수 없습니다.")
            ex is AuthenticationException -> PublicError(HttpStatus.UNAUTHORIZED, "인증이 필요합니다.")
            ex is ErrorResponse -> PublicError(ex.statusCode, safeHttpDetail(ex.statusCode))
            else -> PublicError(HttpStatus.INTERNAL_SERVER_ERROR, safeHttpDetail(HttpStatus.INTERNAL_SERVER_ERROR))
        }

        /** 프레임워크 오류의 상태는 유지하며 입력값·경로·내부 사유 대신 고정 설명 사용. */
        fun safeHttpDetail(status: HttpStatusCode): String = when {
            status.value() == HttpStatus.TOO_MANY_REQUESTS.value() -> "로그인 시도가 잠시 제한되었습니다."
            status.is4xxClientError -> "요청을 처리할 수 없습니다."
            else -> "서버에서 요청을 처리하지 못했습니다."
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
