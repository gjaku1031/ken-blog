package io.github.gjaku1031.kenblog.account.repository

import io.github.gjaku1031.kenblog.account.domain.UserEntity
import org.springframework.data.jpa.repository.JpaRepository

/**
 * DB에서 직접 관리하는 [UserEntity]를 인증·세션 검사에 조회하는 저장소
 */
interface AccountRepository : JpaRepository<UserEntity, Long> {
    /**
     * `users.username`의 `ascii_bin` 비교 규칙에 따라 계정명을 파생 쿼리로 조회
     *
     * @param username 대소문자를 구분해 찾을 계정명
     * @return 일치하는 [UserEntity], 없으면 `null`
     */
    fun findByUsername(username: String): UserEntity?
}
