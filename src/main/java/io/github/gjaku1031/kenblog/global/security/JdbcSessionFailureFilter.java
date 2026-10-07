package io.github.gjaku1031.kenblog.global.security;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.global.error.*;

import jakarta.servlet.*;
import jakarta.servlet.http.*;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * MVC 밖 JDBC 세션 연결 장애만 503으로 변환하며 메모리 세션 대체 금지
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
@RequiredArgsConstructor
public final class JdbcSessionFailureFilter extends OncePerRequestFilter {
    /**
     * 보안 오류 응답기
     */
    private final SecurityProblemWriter writer;

    /**
     * MVC 밖 장애 기록기
     */
    private final SafeFailureLog failures;

    /**
     * 뒤따르는 세션 필터의 DB 연결 실패만 HTTP 503으로 변환
     *
     * 1. 세션 필터와 요청 처리 실행
     * 2. 연결 장애이면서 응답 미확정인 경우만 503으로 변환
     *
     * @param request 현재 HTTP 요청
     * @param response 현재 HTTP 응답
     * @param chain 나머지 필터 및 MVC 처리 흐름
     */
    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            chain.doFilter(request, response);
        } catch (Exception exception) {
            if (!DatabaseFailures.isDatabaseConnectionFailure(exception)) throw exception;
            String eventId = failures.record(request, exception);
            if (response.isCommitted()) throw exception;
            writer.write(response, HttpStatus.SERVICE_UNAVAILABLE, eventId);
        }
    }
}
