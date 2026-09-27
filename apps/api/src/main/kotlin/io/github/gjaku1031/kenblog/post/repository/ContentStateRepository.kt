package io.github.gjaku1031.kenblog.post.repository

import io.github.gjaku1031.kenblog.post.domain.ContentStateEntity
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query

/** 핀 교체 트랜잭션이 공통으로 잠그는 단일 상태 행. */
interface ContentStateRepository : JpaRepository<ContentStateEntity, Byte> {
    /** @return 전역 핀 순열을 직렬화할 ID 1의 배타 잠금 행. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from ContentStateEntity s where s.id = 1")
    fun lockPins(): ContentStateEntity?
}
