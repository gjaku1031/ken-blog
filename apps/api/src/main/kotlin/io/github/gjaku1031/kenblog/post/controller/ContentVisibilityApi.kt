package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PostVisibilityRequest
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestBody

/** [ContentVisibilityController]의 모든 출간 섹션 공개 범위 변경 HTTP 계약. */
@SecurityRequirement(name = "sessionCookie")
interface ContentVisibilityApi {
    /** @return 부모 출간과 소속을 재검사한 최신 [PostDetailResponse]. */
    @PatchMapping("/api/v1/admin/content/{id}/visibility")
    @Operation(summary = "관리자 출간 콘텐츠 공개 범위 변경", description = "HOME은 프로젝트와 대문을 함께 변경")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400"),
        ApiResponse(responseCode = "401"), ApiResponse(responseCode = "403"),
        ApiResponse(responseCode = "404"), ApiResponse(responseCode = "409")])
    fun change(@PathVariable id: Long, @RequestBody request: PostVisibilityRequest): ResponseEntity<PostDetailResponse>
}
