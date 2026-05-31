package io.github.gjaku1031.kenblog.auth.service

import io.github.gjaku1031.kenblog.account.domain.UserRole
import io.github.gjaku1031.kenblog.auth.dto.CurrentUserResponse
import io.github.gjaku1031.kenblog.auth.dto.LoginRequest
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.authentication.AuthenticationManager
import org.springframework.security.authentication.BadCredentialsException
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.Authentication
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy
import org.springframework.security.web.context.SecurityContextRepository
import org.springframework.stereotype.Service

/**
 * Controller 로그인을 인증 제공자·세션 전략·보안 컨텍스트 저장소와 연결.
 *
 * @property authenticationManager DB 계정과 해시를 검증하는 인증 관리자
 * @property sessionStrategy 세션 ID를 교체하고 기존 CSRF 토큰을 지우는 전략
 * @property contextRepository Redis HTTP 세션에 인증 결과를 명시적으로 저장하는 저장소
 */
@Service
class AuthService(
    private val authenticationManager: AuthenticationManager,
    private val sessionStrategy: SessionAuthenticationStrategy,
    private val contextRepository: SecurityContextRepository,
) {
    /**
     * 자격 증명 검증 후 세션 고정 방어를 적용하고 인증 컨텍스트를 저장.
     *
     * 비밀번호는 공백을 제거하지 않음. BCrypt의 72 UTF-8 바이트 한도 초과나 빈
     * 입력은 동일한 인증 오류로 처리하며 저장된 해시를 응답에 노출하지 않음.
     *
     * @param body 계정명과 원문 비밀번호
     * @param request 기존 CSRF 세션을 가진 HTTP 요청
     * @param response 새 세션 ID 쿠키를 담을 HTTP 응답
     * @return 현재 사용자 이름과 [UserRole]
     * @throws BadCredentialsException 입력 형식 또는 자격 증명이 맞지 않을 때
     */
    fun login(body: LoginRequest, request: HttpServletRequest, response: HttpServletResponse): CurrentUserResponse {
        if (body.username.isBlank() || body.username.length > 64 || body.password.isEmpty() ||
            body.password.toByteArray(Charsets.UTF_8).size > 72) {
            throw BadCredentialsException("Invalid credentials")
        }
        val authentication = authenticationManager.authenticate(
            UsernamePasswordAuthenticationToken.unauthenticated(body.username, body.password),
        )
        sessionStrategy.onAuthentication(authentication, request, response)
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
}
