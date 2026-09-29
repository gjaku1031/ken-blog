package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.ContentFeedPage
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam

/** [ContentFeedController]의 PUBLIC 혼합 피드와 검색 HTTP 계약. */
interface ContentFeedApi {
    /** @return Tech·Notes의 PUBLIC 최신 페이지. */
    @GetMapping("/api/v1/feed")
    @Operation(summary = "Home 혼합 피드")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400")])
    fun feed(@RequestParam(defaultValue = "all") section: String,
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


}
