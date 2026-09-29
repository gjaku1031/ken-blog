package io.github.gjaku1031.kenblog.project.controller

import io.github.gjaku1031.kenblog.project.dto.ProjectAdminDetailResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminInfo
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectDetailResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectRelatedPageResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import tools.jackson.databind.JsonNode

/** 공개·관리자별 프로젝트 읽기를 [ProjectController]에 연결하는 HTTP 계약. */
@RequestMapping("/api/v1/projects")
interface ProjectApi {
    /** @return 현재 역할로 읽을 수 있는 출간 대문 페이지. */
    @GetMapping
    @Operation(summary = "프로젝트 목록")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400")])
    fun list(@RequestParam(defaultValue = "0") page: Int, @RequestParam(defaultValue = "12") size: Int,
        authentication: Authentication?): ResponseEntity<ProjectPageResponse>

    /** @return 부모 공개 범위에 맞춘 대문·문서·관련 글. */
    @GetMapping("/{slug}")
    @Operation(summary = "프로젝트 대문과 문서 목록")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "404")])
    fun detail(@PathVariable slug: String, authentication: Authentication?): ResponseEntity<ProjectDetailResponse>

    /** @return 현재 역할에 보이는 관련 Tech 글 페이지. */
    @GetMapping("/{slug}/related-posts")
    @Operation(summary = "프로젝트 관련 Tech 글")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400"), ApiResponse(responseCode = "404")])
    fun related(@PathVariable slug: String, @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "5") size: Int, authentication: Authentication?): ResponseEntity<ProjectRelatedPageResponse>
}

/** 프로젝트 삭제·문서 순서를 [AdminProjectController]에 연결하는 관리자 HTTP 계약. */
@RequestMapping("/api/v1/admin/projects")
@SecurityRequirement(name = "sessionCookie")
interface AdminProjectApi {
    /** @return 초안을 포함한 관리자 프로젝트 페이지. */
    @GetMapping
    @Operation(summary = "관리자 프로젝트 목록")
    fun list(@RequestParam(defaultValue = "0") page: Int, @RequestParam(defaultValue = "20") size: Int): ResponseEntity<ProjectAdminPageResponse>

    /** @return 원문과 전체 문서 순서를 포함한 관리자 상세. */
    @GetMapping("/{id}")
    @Operation(summary = "관리자 프로젝트 상세")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "404")])
    fun detail(@PathVariable id: Long): ResponseEntity<ProjectAdminDetailResponse>

    /** @return 기존 음수·0 값을 포함한 안전 정수 카드 순서를 저장한 메타데이터. */
    @PutMapping("/{id}/order")
    @Operation(summary = "프로젝트 카드 숫자 순서 지정")
    fun setOrder(@PathVariable id: Long, @RequestBody request: ProjectOrderRequest): ResponseEntity<ProjectAdminInfo>

    /** @return 대문과 소속 문서를 제거한 HTTP 204. */
    @DeleteMapping("/{id}")
    @Operation(summary = "프로젝트 삭제")
    @ApiResponses(value = [ApiResponse(responseCode = "204"), ApiResponse(responseCode = "404"), ApiResponse(responseCode = "409")])
    fun delete(@PathVariable id: Long): ResponseEntity<Void>

    /** @return 지정한 소속 문서 한 건을 제거한 HTTP 204. */
    @DeleteMapping("/{id}/documents/{postId}")
    @Operation(summary = "프로젝트 문서 삭제")
    @ApiResponses(value = [ApiResponse(responseCode = "204"), ApiResponse(responseCode = "404"), ApiResponse(responseCode = "409")])
    fun deleteDocument(@PathVariable id: Long, @PathVariable postId: Long): ResponseEntity<Void>


}

/** 한 카드의 정렬값만 교체하는 명시적 숫자 입력. */
data class ProjectOrderRequest(val order: Long)
