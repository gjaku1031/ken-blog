package io.github.gjaku1031.kenblog.global.error;

import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.CannotGetJdbcConnectionException;

import java.sql.*;

/**
 * 예외 원인 체인에서 JDBC 연결·자원 접근 장애만 식별
 */
public final class DatabaseFailures {
    /**
     * 정적 오류 분류 전용
     */
    private DatabaseFailures() {}

    /**
     * 예외 원인 체인에서 JDBC 연결·자원 접근 장애만 식별
     *
     * 제약 위반과 SQL 문법 오류 등은 503으로 잘못 분류하지 않음
     *
     * @return MySQL 연결을 얻거나 유지하지 못한 경우 {@code true}
     */
    public static boolean isDatabaseConnectionFailure(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof CannotGetJdbcConnectionException
                    || cause instanceof DataAccessResourceFailureException
                    || cause instanceof SQLTransientConnectionException
                    || cause instanceof SQLException sql
                            && sql.getSQLState() != null
                            && sql.getSQLState().startsWith("08")) return true;
        }
        return false;
    }
}
