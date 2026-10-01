package io.github.gjaku1031.kenblog.project.service

import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.project.domain.InvalidProjectRequestException
import io.github.gjaku1031.kenblog.project.domain.ProjectConflictException
import io.github.gjaku1031.kenblog.project.domain.ProjectMetadata
import io.github.gjaku1031.kenblog.project.domain.ProjectNotFoundException
import io.github.gjaku1031.kenblog.project.domain.ProjectStatus
import io.github.gjaku1031.kenblog.project.dto.ProjectMetadataRequests
import io.github.gjaku1031.kenblog.project.repository.ProjectRepository
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService
import java.time.Clock
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 본문을 읽지 않고 프로젝트 대문 메타데이터와 뱃지 선택만 갱신. */
@Service
class ProjectMetadataService(private val projects: ProjectRepository,
    private val badges: StackBadgeService) {
    /** 기준 수정 시각을 확인한 뒤 이름·기간·상태·개요·뱃지를 같은 트랜잭션에 저장. */
    @Transactional
    fun update(id: Long, name: String, status: ProjectStatus, startPeriod: String, endPeriod: String?,
        overview: String, stackBadgeNames: List<String>, baseUpdatedAt: LocalDateTime) {
        if (id <= 0 || name.isBlank() || name.codePointCount(0, name.length) > 200 ||
            name.any(Char::isISOControl)) throw InvalidProjectRequestException()
        val project = projects.findLockedById(id) ?: throw ProjectNotFoundException()
        if (project.updatedAt != baseUpdatedAt) throw ProjectConflictException()
        val normalized = ProjectMetadataRequests.validate(ProjectMetadata(status, startPeriod, endPeriod,
            overview, PostVisibility.PUBLIC, baseUpdatedAt, stackBadgeNames))
        val now = LocalDateTime.ofInstant(Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)
        project.rename(name.trim(), now)
        project.replace(normalized, now)
        projects.saveAndFlush(project)
        badges.replaceProjectStack(id, normalized.stackBadgeNames)
    }
}
