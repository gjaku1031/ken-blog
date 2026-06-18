package io.github.gjaku1031.kenblog.draft.controller

import io.github.gjaku1031.kenblog.draft.dto.EditorDraftCreateRequest
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftDetailResponse
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftPageResponse
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftPublishRequest
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftUpdateRequest
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.Parameter
import io.swagger.v3.oas.annotations.enums.ParameterIn
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import tools.jackson.databind.JsonNode

/** ADMIN 세션의 독립 편집본 CRUD·원자적 출간에 대한 HTTP/OpenAPI 계약. */
@RequestMapping("/api/v1/admin/editor-drafts")
@SecurityRequirement(name = "sessionCookie")
interface EditorDraftApi {
    /** @return 새 글 또는 원본 기반 편집본의 Location과 HTTP 201 상세. */
    @PostMapping(consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 편집본 생성", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "201", content = [Content(schema = Schema(implementation = EditorDraftDetailResponse::class))]),
        ApiResponse(responseCode = "400", description = "필수 JSON 타입·길이 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요"),
        ApiResponse(responseCode = "403", description = "ADMIN 또는 CSRF 필요"),
        ApiResponse(responseCode = "404", description = "원본 게시글 또는 분류 없음"),
        ApiResponse(responseCode = "409", description = "원본 시각·단일 편집본 충돌"),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun create(@RequestBody @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true,
        content = [Content(schema = Schema(implementation = EditorDraftCreateRequest::class))]) request: JsonNode):
        ResponseEntity<EditorDraftDetailResponse>

    /** @return 본문을 읽지 않고 저장 시각·ID 내림차순으로 정렬한 관리자 페이지. */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 편집본 목록")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = EditorDraftPageResponse::class))]),
        ApiResponse(responseCode = "400", description = "페이지·원본 ID 오류"),
        ApiResponse(responseCode = "401", description = "인증 필요"),
        ApiResponse(responseCode = "403", description = "ADMIN 필요"),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun list(@RequestParam(defaultValue = "0") page: Int, @RequestParam(defaultValue = "10") size: Int,
        @RequestParam(required = false) postId: Long?): ResponseEntity<EditorDraftPageResponse>

    /** @return 양수 ID의 편집본 전체 내용을 담은 상세. */
    @GetMapping("/{id}", produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 편집본 상세")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = EditorDraftDetailResponse::class))]),
        ApiResponse(responseCode = "400", description = "ID 오류"),
        ApiResponse(responseCode = "401", description = "인증 필요"),
        ApiResponse(responseCode = "403", description = "ADMIN 필요"),
        ApiResponse(responseCode = "404", description = "편집본 없음"),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun detail(@PathVariable("id") id: Long): ResponseEntity<EditorDraftDetailResponse>

    /** @return revision이 일치할 때만 저장한 전체 교체 상세. */
    @PutMapping("/{id}", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 편집본 전체 덮어쓰기", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = EditorDraftDetailResponse::class))]),
        ApiResponse(responseCode = "400", description = "ID·JSON 타입·길이 오류"),
        ApiResponse(responseCode = "401", description = "인증 필요"),
        ApiResponse(responseCode = "403", description = "ADMIN 또는 CSRF 필요"),
        ApiResponse(responseCode = "404", description = "편집본 또는 분류 없음"),
        ApiResponse(responseCode = "409", description = "revision·동시 충돌"),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun update(@PathVariable("id") id: Long,
        @RequestBody @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true,
            content = [Content(schema = Schema(implementation = EditorDraftUpdateRequest::class))]) request: JsonNode):
        ResponseEntity<EditorDraftDetailResponse>

    /** @return 현재 revision의 편집본만 지운 no-store HTTP 204. */
    @DeleteMapping("/{id}")
    @Operation(summary = "관리자 편집본 삭제", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "204", description = "편집본만 삭제"),
        ApiResponse(responseCode = "400", description = "ID·revision 오류"),
        ApiResponse(responseCode = "401", description = "인증 필요"),
        ApiResponse(responseCode = "403", description = "ADMIN 또는 CSRF 필요"),
        ApiResponse(responseCode = "404", description = "편집본 없음"),
        ApiResponse(responseCode = "409", description = "revision·동시 충돌"),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun delete(@PathVariable("id") id: Long, @RequestParam revision: Long): ResponseEntity<Void>

    /** @return 원문과 taxonomy를 원자적으로 반영하고 편집본을 지운 게시글 상세. */
    @PostMapping("/{id}/publish", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 편집본 원자적 출간", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = PostDetailResponse::class))]),
        ApiResponse(responseCode = "400", description = "ID·revision·출간용 내용 오류"),
        ApiResponse(responseCode = "401", description = "인증 필요"),
        ApiResponse(responseCode = "403", description = "ADMIN 또는 CSRF 필요"),
        ApiResponse(responseCode = "404", description = "편집본 또는 분류 없음"),
        ApiResponse(responseCode = "409", description = "revision·원본·slug·동시 충돌"),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun publish(@PathVariable("id") id: Long,
        @RequestBody @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true,
            content = [Content(schema = Schema(implementation = EditorDraftPublishRequest::class))]) request: JsonNode):
        ResponseEntity<PostDetailResponse>
}
