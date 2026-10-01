package io.github.gjaku1031.kenblog.auth.dto

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import io.github.gjaku1031.kenblog.account.domain.UserRole
import io.github.gjaku1031.kenblog.auth.controller.AuthController

/**
 * 단일 관리자 로그인 요청의 원문 비밀번호.
 *
 * [password]는 인증 직후 세션에 저장하지 않으며 로그용 문자열에서도 숨김.
 *
 * @property password 공백을 포함한 원문 비밀번호
 * @property rememberMe 30일 비활동 만료와 30일 브라우저 쿠키 사용 여부; 생략하면 일반 로그인
 */
@JsonIgnoreProperties(value = ["username"])
class LoginRequest(
    val password: String,
    val rememberMe: Boolean = false,
) {
    /**
     * 실수로 요청 객체를 로깅해도 비밀번호가 출력되지 않게 고정 문자열을 반환.
     *
     * @return 비밀값을 제외한 요청 식별 문자열
     */
    override fun toString(): String = "LoginRequest(redacted)"
}

/**
 * [AuthController.csrf]가 발급하는 세션별 CSRF 토큰.
 *
 * @property headerName 변경 요청에 토큰을 넣을 헤더 이름
 * @property token 해당 세션에서만 유효한 토큰
 */
class CsrfResponse(val headerName: String, val token: String) {
    /**
     * 토큰이 일반 로그 문자열에 포함되지 않도록 고정 문자열을 반환.
     *
     * @return 비밀 토큰을 제외한 응답 식별 문자열
     */
    override fun toString(): String = "CsrfResponse(redacted)"
}

/**
 * 인증된 계정의 공개 가능한 최소 정보.
 *
 * @property username 현재 로그인한 계정명
 * @property role 현재 계정의 [UserRole]
 */
data class CurrentUserResponse(val username: String, val role: UserRole)
