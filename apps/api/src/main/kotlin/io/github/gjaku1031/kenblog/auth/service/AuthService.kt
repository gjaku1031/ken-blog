package io.github.gjaku1031.kenblog.auth.service

import io.github.gjaku1031.kenblog.account.domain.UserRole
import io.github.gjaku1031.kenblog.auth.dto.CurrentUserResponse
import io.github.gjaku1031.kenblog.auth.dto.LoginRequest
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.authentication.BadCredentialsException
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.Authentication
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy
import org.springframework.security.web.context.SecurityContextRepository
import org.springframework.stereotype.Service
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/**
 * 관리자 비밀번호·MFA 검증 완료 후에만 세션 전략·보안 컨텍스트 저장소를 연결.
 *
 * @property attempts DB에서 비밀번호·TOTP·복구코드와 실패 횟수를 검증하는 서비스
 * @property sessionStrategy 세션 ID를 교체하고 기존 CSRF 토큰을 지우는 전략
 * @property contextRepository JDBC HTTP 세션에 인증 결과를 명시적으로 저장하는 저장소
 */
@Service
class AuthService(
    private val attempts: AdminLoginAttemptService,
    private val sessionStrategy: SessionAuthenticationStrategy,
    private val contextRepository: SecurityContextRepository,
) {
    /**
     * 두 요소의 DB 검증·커밋 후 세션 고정 방어를 적용하고 인증 컨텍스트를 저장.
     *
     * 비밀번호는 공백을 제거하지 않음. BCrypt의 72 UTF-8 바이트 한도 초과나 빈
     * 입력은 동일한 인증 오류로 처리하며 저장된 해시를 응답에 노출하지 않음.
     *
     * @param body 원문 비밀번호·일회용 검증 코드·로그인 기억 여부
     * @param request 기존 CSRF 세션을 가진 HTTP 요청
     * @param response 새 세션 ID 쿠키를 담을 HTTP 응답
     * @return 현재 사용자 이름과 [UserRole]
     * @throws BadCredentialsException 입력 형식 또는 자격 증명이 맞지 않을 때
     */
    fun login(body: LoginRequest, request: HttpServletRequest, response: HttpServletResponse): CurrentUserResponse {
        val result = attempts.attempt(body.password, body.verificationCode)
        val success = when (result) {
            is AdminLoginResult.Success -> result
            AdminLoginResult.Denied -> throw BadCredentialsException("Invalid credentials")
            AdminLoginResult.Locked -> throw ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS)
        }
        val authentication = UsernamePasswordAuthenticationToken.authenticated(
            success.username, null, listOf(SimpleGrantedAuthority("ROLE_ADMIN")),
        )
        sessionStrategy.onAuthentication(authentication, request, response)
        request.getSession(true).apply {
            maxInactiveInterval = if (body.rememberMe) REMEMBERED_SESSION_TIMEOUT_SECONDS else AUTHENTICATED_SESSION_TIMEOUT_SECONDS
            if (body.rememberMe) {
                setAttribute(REMEMBER_LOGIN_ATTRIBUTE, true)
                request.setAttribute(REMEMBER_COOKIE_REQUEST_ATTRIBUTE, true)
            } else {
                removeAttribute(REMEMBER_LOGIN_ATTRIBUTE)
                request.removeAttribute(REMEMBER_COOKIE_REQUEST_ATTRIBUTE)
            }
            setAttribute(MFA_PROOF_ATTRIBUTE, success.proof)
            setAttribute(MFA_VERSION_ATTRIBUTE, success.version)
        }
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = authentication
        SecurityContextHolder.setContext(context)
        contextRepository.saveContext(context, request, response)
        return currentUser(authentication)
    }

    /**
     * 세션에 복원된 인증 정보에서 계정명과 역할만 반환.
     *
     * @param authentication 세션의 인증 정보
     * @return 해시나 다른 자격 증명을 제외한 [CurrentUserResponse]
     */
    fun currentUser(authentication: Authentication): CurrentUserResponse {
        val role = if (authentication.authorities.any { it.authority == "ROLE_ADMIN" }) UserRole.ADMIN else UserRole.USER
        return CurrentUserResponse(authentication.name, role)
    }

    companion object {
        const val MFA_PROOF_ATTRIBUTE = "KENBLOG_ADMIN_MFA_PROOF"
        const val MFA_VERSION_ATTRIBUTE = "KENBLOG_ADMIN_AUTH_VERSION"
        const val REMEMBER_LOGIN_ATTRIBUTE = "KENBLOG_REMEMBER_LOGIN"
        const val REMEMBER_COOKIE_REQUEST_ATTRIBUTE = "KENBLOG_REMEMBER_COOKIE"
        const val AUTHENTICATED_SESSION_TIMEOUT_SECONDS = 8 * 60 * 60
        const val REMEMBERED_SESSION_TIMEOUT_SECONDS = 30 * 24 * 60 * 60
    }
}
