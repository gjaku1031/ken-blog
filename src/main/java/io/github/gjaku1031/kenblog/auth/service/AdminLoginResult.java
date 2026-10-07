package io.github.gjaku1031.kenblog.auth.service;

/**
 * 로그인 시도 트랜잭션 커밋 후 HTTP 결과를 선택하는 계약
 */
public sealed interface AdminLoginResult
        permits AdminLoginResult.Success, AdminLoginResult.Denied, AdminLoginResult.Locked {
    /**
     * 비밀번호를 검증한 인증 결과
     */
    record Success(
            /**
             * 계정명
             */
            String username,

            /**
             * 세션 인증 증명
             */
            String proof,

            /**
             * 인증 버전
             */
            long version)
            implements AdminLoginResult {}

    /**
     * 잘못된 자격 증명 또는 불완전한 설정
     */
    enum Denied implements AdminLoginResult {
        /**
         * 인증 거부 결과
         */
        INSTANCE
    }

    /**
     * 출처별 실패 또는 전체 비밀번호 연산 한도 도달
     */
    enum Locked implements AdminLoginResult {
        /**
         * 잠금 결과
         */
        INSTANCE
    }
}
