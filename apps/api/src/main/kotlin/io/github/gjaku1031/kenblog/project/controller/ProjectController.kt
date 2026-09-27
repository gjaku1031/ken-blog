package io.github.gjaku1031.kenblog.project.controller

import io.github.gjaku1031.kenblog.project.dto.ProjectDocumentOrders
import io.github.gjaku1031.kenblog.project.dto.ProjectPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectDetailResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectRelatedPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminDetailResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectOrderResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectOrders
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
import tools.jackson.databind.JsonNode

/** [ProjectService]의 부모 권한 판정을 공개 프로젝트 주소에 연결. */
@RestController
class ProjectController(private val service: ProjectService) : ProjectApi {
    /** @return 현재 역할로 읽을 수 있는 출간 대문 목록. */
    override fun list(page: Int, size: Int,
        authentication: Authentication?): ResponseEntity<ProjectPageResponse> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore()).body(service.list(page, size, authentication))

    /** @return 부모와 대문을 확인한 뒤 노출한 대문·문서·관련 글. */
    override fun detail(slug: String, authentication: Authentication?): ResponseEntity<ProjectDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.detail(slug, authentication))

    /** @return 현재 역할에 보이는 관련 TECH 글 페이지. */
    override fun related(slug: String, page: Int,
        size: Int, authentication: Authentication?): ResponseEntity<ProjectRelatedPageResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.related(slug, page, size, authentication))
}

/** 프로젝트 삭제와 문서 순서를 [ProjectService]의 부모 잠금 아래 처리. */
@RestController
class AdminProjectController(private val service: ProjectService) : AdminProjectApi {
    /** @return 관리자 프로젝트 메타데이터 페이지. */
    override fun list(page: Int, size: Int): ResponseEntity<ProjectAdminPageResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminList(page, size))

    /** @return 전체 관리자 카드의 저장 순서와 최소 표시 정보. */
    override fun order(): ResponseEntity<ProjectOrderResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminOrder())

    /** @return 전체 순열·조회 기준을 검증하고 저장한 HTTP 204. */
    override fun reorderProjects(request: JsonNode): ResponseEntity<Void> {
        val (baseIds, projectIds) = ProjectOrders.parse(request)
        service.reorderProjects(baseIds, projectIds)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }

    /** @return 원문과 전체 문서 순서를 포함한 관리자 상세. */
    override fun detail(id: Long): ResponseEntity<ProjectAdminDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminDetail(id))

    /** @return 순환 대문 FK와 소속 글을 같은 트랜잭션에서 제거한 HTTP 204. */
    override fun delete(id: Long): ResponseEntity<Void> {
        service.deleteProject(id)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }

    /** @return 지정한 부모의 문서 한 건만 제거한 HTTP 204. */
    override fun deleteDocument(id: Long, postId: Long): ResponseEntity<Void> {
        service.deleteDocument(id, postId)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }

    /** @return 누락·중복 문서를 거부한 전체 순열 적용 뒤 관리자 상세. */
    override fun reorder(id: Long, request: JsonNode): ResponseEntity<ProjectAdminDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.reorderDocuments(id, ProjectDocumentOrders.parse(request)))
}
