package io.github.gjaku1031.kenblog.project.controller

import io.github.gjaku1031.kenblog.project.dto.ProjectAdminDetailResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminInfo
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectDetailResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectRelatedPageResponse
import io.github.gjaku1031.kenblog.project.service.ProjectService
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

/** [ProjectService]의 부모 권한 판정을 공개 프로젝트 주소에 연결. */
@RestController
@RequestMapping("/api/v1/projects")
class ProjectController(private val service: ProjectService) {
    /** @return 현재 역할로 읽을 수 있는 출간 대문 목록. */
    @GetMapping
    fun list(@RequestParam(defaultValue = "0") page: Int, @RequestParam(defaultValue = "12") size: Int,
        authentication: Authentication?): ResponseEntity<ProjectPageResponse> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore()).body(service.list(page, size, authentication))

    /** @return 부모와 대문을 확인한 뒤 노출한 대문·문서·관련 글. */
    @GetMapping("/{slug}")
    fun detail(@PathVariable slug: String, authentication: Authentication?): ResponseEntity<ProjectDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.detail(slug, authentication))

    /** @return 현재 역할에 보이는 관련 TECH 글 페이지. */
    @GetMapping("/{slug}/related-posts")
    fun related(@PathVariable slug: String, @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "5") size: Int, authentication: Authentication?): ResponseEntity<ProjectRelatedPageResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.related(slug, page, size, authentication))
}

/** 프로젝트 삭제와 문서 순서를 [ProjectService]의 부모 잠금 아래 처리. */
@RestController
@RequestMapping("/api/v1/admin/projects")
class AdminProjectController(private val service: ProjectService) {
    /** @return 관리자 프로젝트 메타데이터 페이지. */
    @GetMapping
    fun list(@RequestParam(defaultValue = "0") page: Int, @RequestParam(defaultValue = "20") size: Int): ResponseEntity<ProjectAdminPageResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminList(page, size))

    /** @return 원문과 전체 문서 순서를 포함한 관리자 상세. */
    @GetMapping("/{id}")
    fun detail(@PathVariable id: Long): ResponseEntity<ProjectAdminDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminDetail(id))

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
