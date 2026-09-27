package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.ActivityResponse
import io.github.gjaku1031.kenblog.post.dto.ContentFeedPage
import io.github.gjaku1031.kenblog.post.dto.PinOrderResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import tools.jackson.databind.JsonNode

/** [ContentFeedController]의 역할별 혼합 읽기와 KST 활동 HTTP 계약. */
interface ContentFeedApi {
    /** @return Tech·Notes의 권한별 최신 또는 핀 페이지. */
    @GetMapping("/api/v1/feed")
    @Operation(summary = "Home 혼합 피드")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400")])
    fun feed(@RequestParam(defaultValue = "all") section: String,
        @RequestParam(defaultValue = "new") sort: String,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "10") size: Int,
        @RequestParam(required = false) categoryId: Long?,
        @RequestParam(required = false) tag: String?, authentication: Authentication?): ResponseEntity<ContentFeedPage>

    /** @return 현재 읽을 수 있는 게시글의 제목·원문·분류·태그 검색 페이지. */
    @GetMapping("/api/v1/search")
    @Operation(summary = "전체 글 검색")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400")])
    fun search(@RequestParam q: String, @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "10") size: Int,
        authentication: Authentication?): ResponseEntity<ContentFeedPage>

    /** @return 최근 KST 날짜마다 출간한 읽기 가능 글 수. */
    @GetMapping("/api/v1/activity")
    @Operation(summary = "글쓰기 활동 달력")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400")])
    fun activity(@RequestParam(defaultValue = "6") months: Int,
        authentication: Authentication?): ResponseEntity<ActivityResponse>
}

/** [AdminPinController]의 전체 핀 순열 관리 HTTP 계약. */
@SecurityRequirement(name = "sessionCookie")
interface AdminPinApi {
    /** @return 현재 저장된 핀 ID 순서. */
    @GetMapping("/api/v1/admin/pins")
    @Operation(summary = "관리자 핀 목록")
    fun list(): ResponseEntity<PinOrderResponse>

    /** @return 전체 순열을 원자적으로 교체한 핀 ID 순서. */
    @PutMapping("/api/v1/admin/pins")
    @Operation(summary = "관리자 핀 순서 전체 교체")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400"),
        ApiResponse(responseCode = "401"), ApiResponse(responseCode = "403"), ApiResponse(responseCode = "409")])
    fun replace(@RequestBody request: JsonNode): ResponseEntity<PinOrderResponse>
}
