package io.github.gjaku1031.kenblog.auth.controller

import io.github.gjaku1031.kenblog.auth.dto.CsrfResponse
import io.github.gjaku1031.kenblog.auth.dto.CurrentUserResponse
import io.github.gjaku1031.kenblog.auth.dto.LoginRequest
import io.github.gjaku1031.kenblog.auth.service.AuthService
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler
import org.springframework.security.web.csrf.CsrfLogoutHandler
import org.springframework.security.web.csrf.CsrfToken
import org.springframework.security.web.csrf.CsrfTokenRepository
import org.springframework.web.bind.annotation.RestController

/**
 * [AuthApi]를 구현하고 Spring Security의 세션·CSRF 수명 주기를 처리.
 *
 * @property service 인증 성공 시 보안 컨텍스트를 저장할 서비스
 * @property csrfRepository 로그인·로그아웃과 공유하는 CSRF 토큰 저장소
 */
@RestController
class AuthController(
    private val service: AuthService,
    csrfRepository: CsrfTokenRepository,
) : AuthApi {
    private val csrfLogoutHandler = CsrfLogoutHandler(csrfRepository)
    private val securityLogoutHandler = SecurityContextLogoutHandler()

    /**
     * 현재 세션의 CSRF 토큰과 요청 헤더명을 반환.
     *
     * @param token Security 필터가 생성한 [CsrfToken]
     * @return 안전하지 않은 HTTP 요청에 필요한 [CsrfResponse]
     */
    override fun csrf(token: CsrfToken): CsrfResponse = CsrfResponse(token.headerName, token.token)

    /**
     * CSRF 필터가 허용한 로그인 요청으로 인증 세션을 생성.
     *
     * @param body 계정명과 비밀번호
     * @param request 기존 CSRF 세션 요청
     * @param response 새 세션 쿠키 응답
     * @return 로그인된 [CurrentUserResponse]
     */
    override fun login(body: LoginRequest, request: HttpServletRequest, response: HttpServletResponse): CurrentUserResponse =
        service.login(body, request, response)

    /**
     * 현재 세션 인증의 계정명과 권한을 반환.
     *
     * @param authentication 복원된 인증 정보
     * @return 현재 [CurrentUserResponse]
     */
    override fun me(authentication: Authentication): CurrentUserResponse = service.currentUser(authentication)

    /**
     * 세션과 인증 컨텍스트를 지우고 이전 CSRF 토큰을 무효화.
     *
     * @param authentication 로그아웃할 인증 정보
     * @param request 현재 세션 요청
     * @param response 세션 쿠키 제거 응답
     * @return 본문 없는 HTTP 204
     */
    override fun logout(
        authentication: Authentication,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): ResponseEntity<Void> {
        securityLogoutHandler.logout(request, response, authentication)
        csrfLogoutHandler.logout(request, response, authentication)
        return ResponseEntity.noContent().build()
    }
}
