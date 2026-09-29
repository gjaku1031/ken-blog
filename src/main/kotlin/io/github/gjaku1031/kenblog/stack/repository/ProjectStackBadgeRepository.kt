package io.github.gjaku1031.kenblog.stack.repository

import io.github.gjaku1031.kenblog.stack.domain.ProjectStackBadgeEntity
import io.github.gjaku1031.kenblog.stack.domain.ProjectStackBadgeId
import org.springframework.data.jpa.repository.JpaRepository

/** [ProjectStackBadgeEntity]의 프로젝트별 연결과 사용 수 조회. */
interface ProjectStackBadgeRepository : JpaRepository<ProjectStackBadgeEntity, ProjectStackBadgeId> {
    /** @return 프로젝트에 선택된 뱃지 연결을 저장 순서로 반환. */
    fun findByIdProjectIdOrderBySortOrder(projectId: Long): List<ProjectStackBadgeEntity>

    /** @return 해당 뱃지를 사용하는 프로젝트 수. */
    fun countByIdBadgeId(badgeId: Long): Long

    /** 프로젝트 출간 변경 전 기존 선택을 모두 제거. */
    fun deleteByIdProjectId(projectId: Long)
}
