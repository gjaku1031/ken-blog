package io.github.gjaku1031.kenblog.auth.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.account.domain.UserRole;
import io.github.gjaku1031.kenblog.auth.dto.*;

import jakarta.servlet.http.*;

import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.*;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

/**
 * 비밀번호 검증 트랜잭션 완료 후 세션 전략·보안 컨텍스트 저장소 연결
 */
@Service
@RequiredArgsConstructor
public final class AuthService {
    /**
     * 로그인 검증·실패 제한
     */
    private final AdminLoginAttemptService attempts;

    /**
     * 신뢰 프록시 또는 직접 출처
     */
    private final LoginSource sources;

    /**
     * 로그인 성공 세션 교체 전략
     */
    private final SessionAuthenticationStrategy sessionStrategy;

    /**
     * 세션 인증 컨텍스트 저장소
     */
    private final SecurityContextRepository contextRepository;

    /**
     * 세션 인증 증명 속성명
     */
    public static final String AUTH_PROOF_ATTRIBUTE = "KENBLOG_ADMIN_PASSWORD_PROOF";

    /**
     * 세션 인증 버전 속성명
     */
    public static final String AUTH_VERSION_ATTRIBUTE = "KENBLOG_ADMIN_AUTH_VERSION";

    /**
     * 영속 쿠키 기록 요청 속성명
     */
    public static final String REMEMBER_COOKIE_REQUEST_ATTRIBUTE = "KENBLOG_REMEMBER_COOKIE";

    /**
     * 일반 로그인 비활동 한도, 초 단위
     */
    public static final int AUTHENTICATED_SESSION_TIMEOUT_SECONDS = 8 * 60 * 60;

    /**
     * 유지 로그인 비활동 한도, 초 단위
     */
    public static final int REMEMBERED_SESSION_TIMEOUT_SECONDS = 30 * 24 * 60 * 60;

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
     * @return 현재 사용자 이름과 {@link UserRole}
     * @throws BadCredentialsException 입력 형식 또는 자격 증명이 맞지 않을 때
     */
    public CurrentUserResponse login(
            LoginRequest body, HttpServletRequest request, HttpServletResponse response) {
        var result = attempts.attempt(body.password(), sources.key(request));
        if (result == AdminLoginResult.Denied.INSTANCE)
            throw new BadCredentialsException("Invalid credentials");
        if (result == AdminLoginResult.Locked.INSTANCE)
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS);
        var success = (AdminLoginResult.Success) result;
        var authentication =
                UsernamePasswordAuthenticationToken.authenticated(
                        success.username(),
                        null,
                        List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
        sessionStrategy.onAuthentication(authentication, request, response);
        // 기억 여부는 요청 속성으로 쿠키 직렬화기에 전달
        var session = request.getSession(true);
        session.setMaxInactiveInterval(
                body.rememberMe()
                        ? REMEMBERED_SESSION_TIMEOUT_SECONDS
                        : AUTHENTICATED_SESSION_TIMEOUT_SECONDS);
        if (body.rememberMe()) request.setAttribute(REMEMBER_COOKIE_REQUEST_ATTRIBUTE, true);
        else request.removeAttribute(REMEMBER_COOKIE_REQUEST_ATTRIBUTE);
        session.setAttribute(AUTH_PROOF_ATTRIBUTE, success.proof());
        session.setAttribute(AUTH_VERSION_ATTRIBUTE, success.version());
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        contextRepository.saveContext(context, request, response);
        return currentUser(authentication);
    }

    /**
     * 세션에 복원된 인증 정보에서 계정명과 역할만 반환
     *
     * @param authentication 세션의 인증 정보
     * @return 해시나 다른 자격 증명을 제외한 {@link CurrentUserResponse}
     */
    public CurrentUserResponse currentUser(Authentication authentication) {
        var role =
                authentication.getAuthorities().stream()
                                .anyMatch(
                                        authority -> authority.getAuthority().equals("ROLE_ADMIN"))
                        ? UserRole.ADMIN
                        : UserRole.USER;
        return new CurrentUserResponse(authentication.getName(), role);
    }
}
