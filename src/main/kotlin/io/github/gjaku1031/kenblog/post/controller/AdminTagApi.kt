package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.TagCountResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping

/** ADMIN 자동완성에서 초안까지 포함한 태그 사용량을 제공하는 계약. */
@RequestMapping("/api/v1/admin/tags")
@SecurityRequirement(name = "sessionCookie")
interface AdminTagApi {
    /** @return 글 사용량 내림차순·이름 오름차순의 태그 집계 목록. */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 태그 사용량")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = TagCountResponse::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요"),
        ApiResponse(responseCode = "403", description = "관리자 권한 필요"),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun list(): ResponseEntity<List<TagCountResponse>>
}
