package io.github.gjaku1031.kenblog.account.domain;


/**
 * {@code UserEntity.role}에 저장하는 계정 권한
 * 로그인은 설정된 활성 ADMIN 계정으로 제한
 */
public enum UserRole {
    /**
     * 관리자
     */
    ADMIN,

    /**
     * 일반 사용자
     */
    USER
}
