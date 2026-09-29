package io.github.gjaku1031.kenblog.stack.domain

import jakarta.persistence.Column
import jakarta.persistence.EmbeddedId
import jakarta.persistence.Embeddable
import jakarta.persistence.Entity
import jakarta.persistence.Table
import java.io.Serializable

/** 프로젝트와 기술 뱃지의 복합 키. */
@Embeddable
data class ProjectStackBadgeId(var projectId: Long = 0, var badgeId: Long = 0) : Serializable

/** 프로젝트 뱃지 선택 순서를 보존하는 연결 행. */
@Entity
@Table(name = "project_stack_badges")
class ProjectStackBadgeEntity protected constructor() {
    @EmbeddedId
    lateinit var id: ProjectStackBadgeId
        protected set

    @Column(name = "sort_order", nullable = false)
    var sortOrder: Int = 0
        protected set

    /** 프로젝트 ID와 이미 등록된 뱃지 ID를 순서대로 연결. */
    constructor(projectId: Long, badgeId: Long, sortOrder: Int) : this() {
        id = ProjectStackBadgeId(projectId, badgeId)
        this.sortOrder = sortOrder
    }
}
