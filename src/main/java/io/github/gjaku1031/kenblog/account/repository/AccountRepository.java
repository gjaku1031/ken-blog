package io.github.gjaku1031.kenblog.account.repository;

import io.github.gjaku1031.kenblog.account.domain.UserEntity;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * DB에서 직접 관리하는 {@code UserEntity}를 인증·세션 검사에 조회하는 저장소
 */
public interface AccountRepository extends JpaRepository<UserEntity, Long> {
    /**
     * {@code users.username}의 {@code ascii_bin} 비교 규칙에 따라 계정명을 파생 쿼리로 조회
     *
     * @param username 대소문자를 구분해 찾을 계정명
     * @return 일치하는 {@link UserEntity}, 없으면 {@code null}
     */
    UserEntity findByUsername(String username);
}
