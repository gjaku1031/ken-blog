package io.github.gjaku1031.kenblog.global.security

import io.github.gjaku1031.kenblog.account.repository.AccountRepository
import io.github.gjaku1031.kenblog.account.domain.UserRole
import io.github.gjaku1031.kenblog.auth.service.AdminLoginAttemptService
import io.github.gjaku1031.kenblog.auth.service.AuthService
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.authentication.AnonymousAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/**
 * JDBC 세션 복원 뒤 단일 관리자와 인증 증명·설정 버전을 매 요청에서 재검사
 */
@Component
class AccountSessionValidationFilter(
    /**
     * 계정 조회 저장소
     */
    private val accounts: AccountRepository,
    /**
     * 로그인 검증·실패 제한 서비스
     */
    private val attempts: AdminLoginAttemptService,
) : OncePerRequestFilter() {
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
     * @param filterChain 권한 필터까지 이어지는 체인
     */
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, filterChain: FilterChain) {
        // 복원된 인증 컨텍스트 확인
        val authentication = SecurityContextHolder.getContext().authentication
        if (authentication != null && authentication.isAuthenticated && authentication !is AnonymousAuthenticationToken) {
            // DB 계정과 세션 증명·설정 버전 재검증
            val account = accounts.findByUsername(authentication.name)
            val session = request.getSession(false)
            if (account == null || !account.enabled || account.role != UserRole.ADMIN ||
                authentication.authorities.none { it.authority == "ROLE_ADMIN" } ||
                !attempts.isValidSession(
                    authentication.name,
                    account.passwordHash,
                    session?.getAttribute(AuthService.AUTH_PROOF_ATTRIBUTE),
                    session?.getAttribute(AuthService.AUTH_VERSION_ATTRIBUTE),
                )) {
                // 불일치하면 세션·인증 컨텍스트 폐기
                request.getSession(false)?.invalidate()
                SecurityContextHolder.clearContext()
            }
        }
        // 최종 접근 허용·거부는 후속 보안 필터에 위임
        filterChain.doFilter(request, response)
    }
}
