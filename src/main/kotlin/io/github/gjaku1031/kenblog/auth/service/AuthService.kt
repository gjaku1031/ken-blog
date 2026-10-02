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
 * 관리자 비밀번호 검증 완료 후에만 세션 전략·보안 컨텍스트 저장소를 연결
 */
@Service
class AuthService(
    /**
     * 로그인 검증·실패 제한 서비스
     */
    private val attempts: AdminLoginAttemptService,

    /**
     * 로그인 성공 시 세션 교체 전략
     */
    private val sessionStrategy: SessionAuthenticationStrategy,

    /**
     * 세션 인증 컨텍스트 저장소
     */
    private val contextRepository: SecurityContextRepository,
) {
    /**
     * 비밀번호의 DB 검증·커밋 후 세션 고정 방어를 적용하고 인증 컨텍스트를 저장
     *
     * 비밀번호는 공백을 제거하지 않음
     * BCrypt의 72 UTF-8 바이트 한도 초과나 빈
     * 입력은 동일한 인증 오류로 처리하며 저장된 해시를 응답에 노출하지 않음
     *
     * 1. 로그인 시도 트랜잭션 완료 후 성공·거부·잠금 결과 구분
     * 2. 인증 객체 생성 후 세션 ID·CSRF 토큰 교체
     * 3. 로그인 유지 여부에 따른 수명·쿠키 설정과 인증 증명 저장
     * 4. 새 인증 컨텍스트를 세션에 명시적으로 저장
     *
     * @param body 원문 비밀번호·로그인 기억 여부
     * @param request 기존 CSRF 세션을 가진 HTTP 요청
     * @param response 새 세션 ID 쿠키를 담을 HTTP 응답
     * @return 현재 사용자 이름과 [UserRole]
     * @throws BadCredentialsException 입력 형식 또는 자격 증명이 맞지 않을 때
     */
    fun login(body: LoginRequest, request: HttpServletRequest, response: HttpServletResponse): CurrentUserResponse {
        // 로그인 시도 트랜잭션 완료 후 성공·거부·잠금 결과 구분
        val result = attempts.attempt(body.password)
        val success = when (result) {
            is AdminLoginResult.Success -> result
            AdminLoginResult.Denied -> throw BadCredentialsException("Invalid credentials")
            AdminLoginResult.Locked -> throw ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS)
        }
        // 인증 객체 생성 후 세션 ID·CSRF 토큰 교체
        val authentication = UsernamePasswordAuthenticationToken.authenticated(
            success.username, null, listOf(SimpleGrantedAuthority("ROLE_ADMIN")),
        )
        sessionStrategy.onAuthentication(authentication, request, response)
        // 로그인 유지 여부에 따른 수명·쿠키 설정과 인증 증명 저장
        request.getSession(true).apply {
            maxInactiveInterval = if (body.rememberMe) REMEMBERED_SESSION_TIMEOUT_SECONDS else AUTHENTICATED_SESSION_TIMEOUT_SECONDS
            if (body.rememberMe) {
                setAttribute(REMEMBER_LOGIN_ATTRIBUTE, true)
                request.setAttribute(REMEMBER_COOKIE_REQUEST_ATTRIBUTE, true)
            } else {
                removeAttribute(REMEMBER_LOGIN_ATTRIBUTE)
                request.removeAttribute(REMEMBER_COOKIE_REQUEST_ATTRIBUTE)
            }
            setAttribute(AUTH_PROOF_ATTRIBUTE, success.proof)
            setAttribute(AUTH_VERSION_ATTRIBUTE, success.version)
        }
        // 새 인증 컨텍스트를 세션에 명시적으로 저장
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = authentication
        SecurityContextHolder.setContext(context)
        contextRepository.saveContext(context, request, response)
        return currentUser(authentication)
    }

    /**
     * 세션에 복원된 인증 정보에서 계정명과 역할만 반환
     *
     * @param authentication 세션의 인증 정보
     * @return 해시나 다른 자격 증명을 제외한 [CurrentUserResponse]
     */
    fun currentUser(authentication: Authentication): CurrentUserResponse {
        val role = if (authentication.authorities.any { it.authority == "ROLE_ADMIN" }) UserRole.ADMIN else UserRole.USER
        return CurrentUserResponse(authentication.name, role)
    }

    /**
     * 공통 상수·도우미
     */
    companion object {
        /**
         * 세션 인증 증명 속성명
         */
        const val AUTH_PROOF_ATTRIBUTE = "KENBLOG_ADMIN_PASSWORD_PROOF"

        /**
         * 세션 인증 버전 속성명
         */
        const val AUTH_VERSION_ATTRIBUTE = "KENBLOG_ADMIN_AUTH_VERSION"

        /**
         * 로그인 유지 세션 속성명
         */
        const val REMEMBER_LOGIN_ATTRIBUTE = "KENBLOG_REMEMBER_LOGIN"

        /**
         * 영속 세션 쿠키 기록 요청 속성명
         */
        const val REMEMBER_COOKIE_REQUEST_ATTRIBUTE = "KENBLOG_REMEMBER_COOKIE"

        /**
         * 일반 로그인 세션 비활동 한도, 초 단위
         */
        const val AUTHENTICATED_SESSION_TIMEOUT_SECONDS = 8 * 60 * 60

        /**
         * 유지 로그인 세션 비활동 한도, 초 단위
         */
        const val REMEMBERED_SESSION_TIMEOUT_SECONDS = 30 * 24 * 60 * 60
    }
}
