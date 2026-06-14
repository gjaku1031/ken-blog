package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.TagCountResponse
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

/** 현재 열람 권한의 출간 글에 쓰인 태그 이름·횟수만 노출하는 공개 계약. */
@RequestMapping("/api/v1/tags")
interface PublicTagApi {
    /** @return 권한별 SQL 집계의 no-store 목록. */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "공개 태그 사용량", description = "익명 PRIVATE 전용·초안 전용 태그 제외")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = TagCountResponse::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애"),
    ])
    fun list(@Parameter(hidden = true) authentication: Authentication?): ResponseEntity<List<TagCountResponse>>
}
