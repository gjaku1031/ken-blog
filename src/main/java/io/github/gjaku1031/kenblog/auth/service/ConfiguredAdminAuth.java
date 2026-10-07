package io.github.gjaku1031.kenblog.auth.service;

/**
 * 검증된 단일 관리자 설정
 */
public record ConfiguredAdminAuth(
        /**
         * 계정명
         */
        String username,

        /**
         * 관리자 설정 지문
         */
        String fingerprint) {}
