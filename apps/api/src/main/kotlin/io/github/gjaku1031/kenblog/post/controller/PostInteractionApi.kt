package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.PostTodoResponse
import io.github.gjaku1031.kenblog.post.dto.PostViewResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import tools.jackson.databind.JsonNode

/** [PostViewController]의 CSRF 보호 공개 조회 집계 HTTP 계약. */
interface PostViewApi {
    /** @return 읽기 가능 글의 현재 저장 조회 수. */
    @PostMapping("/api/v1/posts/{id}/view")
    @Operation(summary = "게시글 조회 집계")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "403"),
        ApiResponse(responseCode = "404")])
    fun record(@PathVariable id: Long, authentication: Authentication?,
        request: HttpServletRequest): ResponseEntity<PostViewResponse>
}

/** [PostTodoController]의 관리자 읽기 체크박스 변경 HTTP 계약. */
@SecurityRequirement(name = "sessionCookie")
interface PostTodoApi {
    /** @return 변경된 Markdown 본문과 새 SHA-256. */
    @PatchMapping("/api/v1/admin/posts/{id}/todo")
    @Operation(summary = "관리자 게시글 할 일 체크 변경")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400"),
        ApiResponse(responseCode = "401"), ApiResponse(responseCode = "403"),
        ApiResponse(responseCode = "404"), ApiResponse(responseCode = "409")])
    fun toggle(@PathVariable id: Long, @RequestBody request: JsonNode): ResponseEntity<PostTodoResponse>
}
