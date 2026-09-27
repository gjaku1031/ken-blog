package io.github.gjaku1031.kenblog.profile.repository

import io.github.gjaku1031.kenblog.profile.domain.HomeProfileEntity
import org.springframework.data.jpa.repository.JpaRepository

/** [HomeProfileEntity] 단일 행을 [JpaRepository]로 조회·저장. */
interface HomeProfileRepository : JpaRepository<HomeProfileEntity, Long>
