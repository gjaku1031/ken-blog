package io.github.gjaku1031.kenblog.account.repository

import io.github.gjaku1031.kenblog.account.domain.UserEntity
import io.github.gjaku1031.kenblog.account.service.AccountService
import org.springframework.data.jpa.repository.JpaRepository

/**
 * [UserEntity]의 기본 저장·행 수 조회를 [JpaRepository]에 맡기는 계정 저장소.
 *
 * [AccountService.ensureInitialAdmin]은 [JpaRepository.count]로 빈 DB를 확인하고,
 * 새 계정을 [JpaRepository.saveAndFlush]로 저장하여 제약 오류를 즉시 확인함.
 */
interface AccountRepository : JpaRepository<UserEntity, Long> {
    /**
     * `users.username`의 `ascii_bin` 비교 규칙에 따라 계정명을 파생 쿼리로 조회.
     *
     * @param username 대소문자를 구분해 찾을 계정명
     * @return 일치하는 [UserEntity], 없으면 `null`
     */
    fun findByUsername(username: String): UserEntity?
}
