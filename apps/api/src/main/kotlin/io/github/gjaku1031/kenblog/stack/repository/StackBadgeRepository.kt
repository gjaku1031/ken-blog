package io.github.gjaku1031.kenblog.stack.repository

import io.github.gjaku1031.kenblog.stack.domain.StackBadgeEntity
import org.springframework.data.jpa.repository.JpaRepository

/** [StackBadgeEntity]의 CRUD와 대소문자 무시 키 조회. */
interface StackBadgeRepository : JpaRepository<StackBadgeEntity, Long> {
    /** @return 정규화된 이름과 일치하는 뱃지 또는 `null`. */
    fun findByNameKey(nameKey: String): StackBadgeEntity?
}
