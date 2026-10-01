package io.github.gjaku1031.kenblog.project.controller

import io.github.gjaku1031.kenblog.project.dto.ProjectAdminDetailResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminInfo
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectDetailResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectRelatedPageResponse
import io.github.gjaku1031.kenblog.project.service.ProjectService
import io.github.gjaku1031.kenblog.project.service.ProjectMetadataService
import io.github.gjaku1031.kenblog.project.domain.ProjectStatus
import io.github.gjaku1031.kenblog.project.domain.InvalidProjectRequestException
import java.time.LocalDateTime
import java.time.format.DateTimeParseException
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** 프로젝트 삭제와 문서 순서를 [ProjectService]의 부모 잠금 아래 처리. */
@RestController
@RequestMapping("/api/v1/admin/projects")
class AdminProjectController(private val service: ProjectService, private val metadata: ProjectMetadataService) {
    /** @return 관리자 프로젝트 메타데이터 페이지. */
    @GetMapping
    fun list(@RequestParam(defaultValue = "0") page: Int, @RequestParam(defaultValue = "20") size: Int): ResponseEntity<ProjectAdminPageResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminList(page, size))

    /** @return 원문과 전체 문서 순서를 포함한 관리자 상세. */
    @GetMapping("/{id}")
    fun detail(@PathVariable id: Long): ResponseEntity<ProjectAdminDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminDetail(id))

    /** 프로젝트 대문 원문을 건드리지 않고 기준 수정 시각으로 메타데이터를 갱신. */
    @PutMapping("/{id}/metadata")
    fun updateMetadata(@PathVariable id: Long, @RequestBody request: ProjectMetadataUpdateRequest): ResponseEntity<ProjectAdminDetailResponse> {
        val base = try { LocalDateTime.parse(request.baseUpdatedAt) }
        catch (_: DateTimeParseException) { throw InvalidProjectRequestException() }
        metadata.update(id, request.name, request.status, request.startPeriod, request.endPeriod,
            request.overview, request.stackBadgeNames, base)
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminDetail(id))
    }

    /** @return 같은 게이트 아래 저장된 카드 숫자 순서. */
    @PutMapping("/{id}/order")
    fun setOrder(@PathVariable id: Long, @RequestBody request: ProjectOrderRequest): ResponseEntity<ProjectAdminInfo> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.setOrder(id, request.order))

    /** @return 순환 대문 FK와 소속 글을 같은 트랜잭션에서 제거한 HTTP 204. */
    @DeleteMapping("/{id}")
    fun delete(@PathVariable id: Long): ResponseEntity<Void> {
        service.deleteProject(id)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }

    /** @return 지정한 부모의 문서 한 건만 제거한 HTTP 204. */
    @DeleteMapping("/{id}/documents/{postId}")
    fun deleteDocument(@PathVariable id: Long, @PathVariable postId: Long): ResponseEntity<Void> {
        service.deleteDocument(id, postId)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }
}

/** 관리자 프로젝트 카드의 표시 순서 입력. */
data class ProjectOrderRequest(val order: Long)

/** 프로젝트 대문과 뱃지 선택의 메타데이터 입력. */
data class ProjectMetadataUpdateRequest(
    val name: String,
    val status: ProjectStatus,
    val startPeriod: String,
    val endPeriod: String?,
    val overview: String,
    val stackBadgeNames: List<String>,
    val baseUpdatedAt: String,
)
