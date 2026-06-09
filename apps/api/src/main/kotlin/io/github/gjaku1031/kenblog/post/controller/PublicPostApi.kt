package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.PublicPostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PublicPostPageResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.Parameter
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam

/**
 * 출간 글 목록과 직접 slug 조회의 공개 HTTP/OpenAPI 계약.
 *
 * 인증 세션이 있으면 ROLE_USER·ROLE_ADMIN으로 PRIVATE 열람을 허용함.
 */
@RequestMapping("/api/v1/posts")
interface PublicPostApi {
    /**
     * 권한별 목록·건수를 조회하고 본문 없는 페이지를 반환.
     *
     * @param page 0 기반 페이지, 기본 0
     * @param size 1~100 페이지 크기, 기본 10
     * @param authentication 현재 세션 인증 또는 익명 토큰
     * @return 캐시하지 않는 [PublicPostPageResponse]
     */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "출간 게시글 목록", description = "익명은 PUBLIC, USER·ADMIN은 PUBLIC과 PRIVATE를 조회")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = PublicPostPageResponse::class))]),
        ApiResponse(responseCode = "400", description = "페이지 입력 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun list(
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "10") size: Int,
        @Parameter(hidden = true) authentication: Authentication?,
    ): ResponseEntity<PublicPostPageResponse>

    /**
     * 출간 글을 직접 조회하고 익명 PRIVATE이면 본문 없는 잠금 상세를 반환.
     *
     * @param slug 게시글 주소
     * @param authentication 현재 세션 인증 또는 익명 토큰
     * @return 캐시하지 않는 [PublicPostDetailResponse]
     */
    @GetMapping("/{slug}", produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "출간 게시글 직접 조회", description = "익명 PRIVATE에는 제목·출간일과 잠금 상태만 반환")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = PublicPostDetailResponse::class))]),
        ApiResponse(responseCode = "404", description = "없는 글 또는 초안", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun detail(@PathVariable("slug") slug: String, @Parameter(hidden = true) authentication: Authentication?): ResponseEntity<PublicPostDetailResponse>
}
