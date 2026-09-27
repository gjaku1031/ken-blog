package io.github.gjaku1031.kenblog.global.security

import io.github.gjaku1031.kenblog.account.repository.AccountRepository
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.authentication.AnonymousAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/** JDBC 세션 복원 뒤 계정 삭제·비활성화·권한 변경을 매 요청에서 재검사. */
@Component
class AccountSessionValidationFilter(private val accounts: AccountRepository) : OncePerRequestFilter() {
    /**
     * 기존 세션 주체가 DB에 없거나 현재 역할과 다르면 즉시 세션을 폐기.
     *
     * @param request 세션을 가진 요청
     * @param response 후속 보안 필터가 401/403을 기록할 응답
     * @param filterChain 권한 필터까지 이어지는 체인
     */
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, filterChain: FilterChain) {
        val authentication = SecurityContextHolder.getContext().authentication
        if (authentication != null && authentication.isAuthenticated && authentication !is AnonymousAuthenticationToken) {
            val account = accounts.findByUsername(authentication.name)
            if (account == null || !account.enabled || authentication.authorities.none { it.authority == "ROLE_${account.role.name}" }) {
                request.getSession(false)?.invalidate()
                SecurityContextHolder.clearContext()
            }
        }
        filterChain.doFilter(request, response)
    }
}
