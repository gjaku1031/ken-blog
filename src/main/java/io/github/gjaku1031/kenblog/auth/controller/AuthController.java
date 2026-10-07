package io.github.gjaku1031.kenblog.auth.controller;

import io.github.gjaku1031.kenblog.auth.dto.*;
import io.github.gjaku1031.kenblog.auth.service.AuthService;

import jakarta.servlet.http.*;

import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.csrf.*;
import org.springframework.web.bind.annotation.*;

/**
 * 로그인·로그아웃과 세션·CSRF 수명 주기 연결
 */
@RestController
@RequestMapping("/api/v1/auth")
public final class AuthController {
    /**
     * 인증 서비스
     */
    private final AuthService service;

    /**
     * 로그아웃 CSRF 토큰 제거
     */
    private final CsrfLogoutHandler csrfLogoutHandler;

    /**
     * 로그아웃 세션·인증 컨텍스트 제거
     */
    private final SecurityContextLogoutHandler securityLogoutHandler =
            new SecurityContextLogoutHandler();

    /**
     * 인증 서비스와 CSRF 저장소 초기화
     */
    public AuthController(AuthService service, CsrfTokenRepository csrfRepository) {
        this.service = service;
        csrfLogoutHandler = new CsrfLogoutHandler(csrfRepository);
    }

    /**
     * 현재 세션의 CSRF 토큰과 요청 헤더명을 반환
     *
     * @param token Security 필터가 생성한 {@link CsrfToken}
     * @return 안전하지 않은 HTTP 요청에 필요한 {@link CsrfResponse}
     */
    @GetMapping(value = "/csrf", produces = MediaType.APPLICATION_JSON_VALUE)
    public CsrfResponse csrf(CsrfToken token) {
        return new CsrfResponse(token.getHeaderName(), token.getToken());
    }

    /**
     * CSRF 필터가 허용한 로그인 요청으로 인증 세션을 생성
     *
     * @param body 관리자 비밀번호와 로그인 유지 여부
     * @param request 기존 CSRF 세션 요청
     * @param response 새 세션 쿠키 응답
     * @return 로그인된 {@link CurrentUserResponse}
     */
    @PostMapping(
            value = "/login",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public CurrentUserResponse login(
            @RequestBody LoginRequest body,
            HttpServletRequest request,
            HttpServletResponse response) {
        return service.login(body, request, response);
    }

    /**
     * 현재 세션 인증의 계정명과 권한을 반환
     *
     * @param authentication 복원된 인증 정보
     * @return 현재 {@link CurrentUserResponse}
     */
    @GetMapping(value = "/me", produces = MediaType.APPLICATION_JSON_VALUE)
    public CurrentUserResponse me(Authentication authentication) {
        return service.currentUser(authentication);
    }

    /**
     * 세션과 인증 컨텍스트를 지우고 이전 CSRF 토큰을 무효화
     *
     * 1. 기존 CSRF 토큰 제거
     * 2. 인증 컨텍스트·세션 폐기 후 204 응답
     *
     * @param authentication 로그아웃할 인증 정보
     * @param request 현재 세션 요청
     * @param response 세션 쿠키 제거 응답
     * @return 본문 없는 HTTP 204
     */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response) {
        securityLogoutHandler.logout(request, response, authentication);
        csrfLogoutHandler.logout(request, response, authentication);
        return ResponseEntity.noContent().build();
    }
}
