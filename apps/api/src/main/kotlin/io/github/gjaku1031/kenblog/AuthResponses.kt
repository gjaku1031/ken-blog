package io.github.gjaku1031.kenblog

import io.swagger.v3.oas.annotations.media.Schema

/**
 * 로그인 요청의 계정명과 원문 비밀번호.
 *
 * [password]는 인증 직후 세션에 저장하지 않으며 로그용 문자열에서도 숨김.
 *
 * @property username 대소문자를 구분하는 관리자 계정명
 * @property password 공백을 포함한 원문 비밀번호
 */
class LoginRequest(
    val username: String,
    @field:Schema(accessMode = Schema.AccessMode.WRITE_ONLY, description = "로그인 검증에만 사용하는 원문 비밀번호")
    val password: String,
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
