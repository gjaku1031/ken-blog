package io.github.gjaku1031.kenblog.category.controller

import io.github.gjaku1031.kenblog.category.dto.CategoryTreeResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.Parameter
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping

/** 빈 폴더를 포함하되 현재 역할에 읽기 허용된 출간 글만 세는 공개 분류 계약. */
@RequestMapping("/api/v1/categories")
interface PublicCategoryApi {
    /** @return 공개 권한 SQL 집계로 만든 no-store 전체 트리. */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "공개 분류 트리", description = "익명은 PUBLIC 글 수만, USER·ADMIN은 PRIVATE 출간 글 수까지 포함")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = CategoryTreeResponse::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun list(@Parameter(hidden = true) authentication: Authentication?): ResponseEntity<List<CategoryTreeResponse>>
}
