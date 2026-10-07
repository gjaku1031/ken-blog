package io.github.gjaku1031.kenblog.auth.service;

import io.github.gjaku1031.kenblog.post.domain.PostBodyHash;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 서버가 지정한 단일 관리자와 인증 방식 지문
 */
@Component
public final class AdminAuthSettings {
    /**
     * 설정한 계정명
     */
    private final String username;

    /**
     * 관리자 계정 설정 초기화
     */
    public AdminAuthSettings(@Value("${app.auth.admin.username:}") String username) {
        this.username = username;
    }

    /**
     * 유효한 관리자와 설정 지문, 미설정이면 null
     */
    public ConfiguredAdminAuth configured() {
        return username.matches("[a-z][a-z0-9_-]{2,63}")
                ? new ConfiguredAdminAuth(username, sha256("admin-password-v2\u0000" + username))
                : null;
    }

    /**
     * 원문을 저장하지 않는 SHA-256 소문자 16진수
     */
    public static String sha256(String value) {
        return PostBodyHash.sha256(value);
    }
}
