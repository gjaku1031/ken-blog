package io.github.gjaku1031.kenblog.global.security;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.account.domain.UserRole;
import io.github.gjaku1031.kenblog.account.repository.AccountRepository;
import io.github.gjaku1031.kenblog.auth.service.*;

import jakarta.servlet.*;
import jakarta.servlet.http.*;

import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * JDBC 세션 복원 뒤 관리자·인증 증명·설정 버전을 매 요청 재검사
 */
@Component
@RequiredArgsConstructor
public final class AccountSessionValidationFilter extends OncePerRequestFilter {
    /**
     * 계정 조회 저장소
     */
    private final AccountRepository accounts;

    /**
     * 로그인 검증·실패 제한 서비스
     */
    private final AdminLoginAttemptService attempts;

    /**
     * 기존 세션 주체가 단일 관리자·활성·관리자 설정에 맞지 않으면 즉시 세션을 폐기
     *
     * 1. 복원된 인증 컨텍스트 확인
     * 2. DB 계정과 세션 증명·설정 버전 재검증
     * 3. 불일치하면 세션·인증 컨텍스트 폐기
     * 4. 최종 접근 허용·거부는 후속 보안 필터에 위임
     *
     * @param request 세션을 가진 요청
     * @param response 후속 보안 필터가 401/403을 기록할 응답
     * @param chain 권한 필터까지 이어지는 체인
     */
    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null
                && authentication.isAuthenticated()
                && !(authentication instanceof AnonymousAuthenticationToken)) {
            var account = accounts.findByUsername(authentication.getName());
            var session = request.getSession(false);
            if (account == null
                    || !account.getEnabled()
                    || account.getRole() != UserRole.ADMIN
                    || authentication.getAuthorities().stream()
                            .noneMatch(authority -> authority.getAuthority().equals("ROLE_ADMIN"))
                    || !attempts.isValidSession(
                            authentication.getName(),
                            account.getPasswordHash(),
                            session == null
                                    ? null
                                    : session.getAttribute(AuthService.AUTH_PROOF_ATTRIBUTE),
                            session == null
                                    ? null
                                    : session.getAttribute(AuthService.AUTH_VERSION_ATTRIBUTE))) {
                if (session != null) session.invalidate();
                SecurityContextHolder.clearContext();
            }
        }
        chain.doFilter(request, response);
    }
}
