package io.github.gjaku1031.kenblog.auth.dto;

/**
 * 세션별 CSRF 토큰 응답
 */
public record CsrfResponse(
        /**
         * CSRF 토큰 요청 헤더명
         */
        String headerName,

        /**
         * 세션별 CSRF 토큰
         */
        String token) {
    /**
     * 토큰이 일반 로그 문자열에 포함되지 않도록 고정 문자열을 반환
     *
     * @return 비밀 토큰을 제외한 응답 식별 문자열
     */
    @Override
    public String toString() {
        return "CsrfResponse(redacted)";
    }
}
