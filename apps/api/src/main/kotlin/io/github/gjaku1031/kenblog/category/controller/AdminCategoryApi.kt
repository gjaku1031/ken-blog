package io.github.gjaku1031.kenblog.category.controller

import io.github.gjaku1031.kenblog.category.dto.CategoryCreateRequest
import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.category.dto.CategoryTreeResponse
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
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import tools.jackson.databind.JsonNode

/** ADMIN 분류 경로 생성·트리 조회·부모 이동 삭제의 HTTP/OpenAPI 계약. */
@RequestMapping("/api/v1/admin/categories")
@SecurityRequirement(name = "sessionCookie")
interface AdminCategoryApi {
    /** @return 중간 경로를 재사용해 생성한 마지막 분류의 HTTP 201 참조. */
    @PostMapping(consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 분류 경로 생성", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "201", content = [Content(schema = Schema(implementation = CategoryRefResponse::class))]),
        ApiResponse(responseCode = "400", description = "경로 깊이·이름·JSON 타입 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요"),
        ApiResponse(responseCode = "403", description = "관리자 권한 또는 CSRF 필요"),
        ApiResponse(responseCode = "409", description = "경로 중복 또는 동시 충돌", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun create(
        @RequestBody @io.swagger.v3.oas.annotations.parameters.RequestBody(
            required = true, content = [Content(schema = Schema(implementation = CategoryCreateRequest::class))],
        ) request: JsonNode,
    ): ResponseEntity<CategoryRefResponse>

    /** @return 초안 포함 직접·하위 글 수를 가진 빈 폴더 포함 전체 트리. */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 분류 트리")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = CategoryTreeResponse::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요"),
        ApiResponse(responseCode = "403", description = "관리자 권한 필요"),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun list(): ResponseEntity<List<CategoryTreeResponse>>

    /**
     * 삭제 분류와 자손의 글을 부모/null로 이동한 후 폴더만 삭제.
     *
     * @param id 양수 분류 ID
     * @return 이동·삭제 커밋 후 no-store HTTP 204
     */
    @DeleteMapping("/{id}")
    @Operation(summary = "관리자 분류 트리 삭제", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "204", description = "글 이동과 분류 삭제 완료"),
        ApiResponse(responseCode = "400", description = "ID 오류"),
        ApiResponse(responseCode = "401", description = "인증 필요"),
        ApiResponse(responseCode = "403", description = "관리자 권한 또는 CSRF 필요"),
        ApiResponse(responseCode = "404", description = "분류 없음"),
        ApiResponse(responseCode = "409", description = "동시 참조 충돌"),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun delete(@PathVariable("id") id: Long): ResponseEntity<Void>
}
