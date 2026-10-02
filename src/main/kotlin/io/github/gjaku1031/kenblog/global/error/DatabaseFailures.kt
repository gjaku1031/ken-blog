package io.github.gjaku1031.kenblog.global.error

import java.sql.SQLException
import java.sql.SQLTransientConnectionException
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.jdbc.CannotGetJdbcConnectionException

/**
 * 예외 원인 체인에서 JDBC 연결·자원 접근 장애만 식별
 *
 * 제약 위반과 SQL 문법 오류 등은 503으로 잘못 분류하지 않음
 *
 * @return MySQL 연결을 얻거나 유지하지 못한 경우 `true`
 */
internal fun Throwable.isDatabaseConnectionFailure(): Boolean = generateSequence(this) { it.cause }.any {
    it is CannotGetJdbcConnectionException || it is DataAccessResourceFailureException ||
        it is SQLTransientConnectionException ||
        (it is SQLException && it.sqlState?.startsWith("08") == true)
}
