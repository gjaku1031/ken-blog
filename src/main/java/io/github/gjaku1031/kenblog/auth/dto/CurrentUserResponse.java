package io.github.gjaku1031.kenblog.auth.dto;

import io.github.gjaku1031.kenblog.account.domain.UserRole;

/**
 * 인증된 계정의 공개 가능한 최소 정보
 */
public record CurrentUserResponse(
        /**
         * 계정명
         */
        String username,

        /**
         * 계정 권한
         */
        UserRole role) {}
