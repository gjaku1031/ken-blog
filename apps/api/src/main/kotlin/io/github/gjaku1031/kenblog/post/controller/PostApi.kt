package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PostPageResponse
import io.github.gjaku1031.kenblog.post.dto.PostWriteRequest
import io.github.gjaku1031.kenblog.post.dto.PostVisibilityRequest
import io.github.gjaku1031.kenblog.post.dto.PostTaxonomyRequest
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
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import tools.jackson.databind.JsonNode

/**
 * 관리자 게시글 작성·목록·상세·전체 교체·삭제·출간 상태의 HTTP/OpenAPI 계약.
 *
 * [PostController]가 구현하며 ADMIN 세션과 쓰기 요청의 기존 CSRF 필터를 사용함.
 */
@RequestMapping("/api/v1/admin/posts")
@SecurityRequirement(name = "sessionCookie")
interface PostApi {
    /**
     * 필수 JSON 세 필드로 초안을 생성.
     *
     * @param request 제목·slug·본문 전체 입력
     * @return 상세 [PostDetailResponse]와 관리자 조회 Location의 HTTP 201
     */
    @PostMapping(consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 초안 생성", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "201", content = [Content(schema = Schema(implementation = PostDetailResponse::class))]),
        ApiResponse(responseCode = "400", description = "입력 또는 JSON 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 또는 CSRF 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "409", description = "slug 중복", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun create(@RequestBody @io.swagger.v3.oas.annotations.parameters.RequestBody(
        required = true, content = [Content(schema = Schema(implementation = PostWriteRequest::class))],
    ) request: JsonNode): ResponseEntity<PostDetailResponse>

    /**
     * 초안·출간 글의 본문을 제외하고 생성 시각·ID 내림차순의 한 페이지를 조회.
     *
     * @param page 0 기반 페이지 번호, 기본 0
     * @param size 1~100 페이지 크기, 기본 20
     * @return 목록과 전체 건수를 담은 [PostPageResponse]
     */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 게시글 목록")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = PostPageResponse::class))]),
        ApiResponse(responseCode = "400", description = "페이지 입력 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun list(
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") size: Int,
    ): ResponseEntity<PostPageResponse>

    /**
     * 양수 ID의 초안·출간 글을 본문 원문까지 조회.
     *
     * @param id 조회할 양수 게시글 식별자
     * @return [PostDetailResponse]
     */
    @GetMapping("/{id}", produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 게시글 상세")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = PostDetailResponse::class))]),
        ApiResponse(responseCode = "400", description = "ID 입력 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "404", description = "게시글 없음", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun detail(@PathVariable("id") id: Long): ResponseEntity<PostDetailResponse>

    /**
     * 양수 ID 게시글의 제목·slug·본문을 모두 교체.
     *
     * @param id 수정할 게시글 식별자
     * @param request 필수 세 필드의 새 값
     * @return ID·생성 시각을 유지한 [PostDetailResponse]
     */
    @PutMapping("/{id}", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 게시글 전체 수정", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = PostDetailResponse::class))]),
        ApiResponse(responseCode = "400", description = "ID·입력·JSON 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 또는 CSRF 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "404", description = "게시글 없음", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "409", description = "slug 중복", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun update(@PathVariable("id") id: Long, @RequestBody @io.swagger.v3.oas.annotations.parameters.RequestBody(
        required = true, content = [Content(schema = Schema(implementation = PostWriteRequest::class))],
    ) request: JsonNode): ResponseEntity<PostDetailResponse>

    /**
     * 양수 ID의 게시글 행을 삭제하며 첨부 객체는 건드리지 않음.
     *
     * @param id 삭제할 게시글 식별자
     * @return 본문 없는 HTTP 204
     */
    @DeleteMapping("/{id}")
    @Operation(summary = "관리자 게시글 삭제", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "204", description = "삭제 완료"),
        ApiResponse(responseCode = "400", description = "ID 입력 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 또는 CSRF 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "404", description = "게시글 없음", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun delete(@PathVariable("id") id: Long): ResponseEntity<Void>

    /**
     * 최초 출간 시각을 보존하며 지정 범위로 출간·재출간.
     *
     * @param id 양수 게시글 ID
     * @param request 필수 공개 범위
     * @return 상태를 포함한 [PostDetailResponse]
     */
    @PostMapping("/{id}/publish", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 게시글 출간", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = PostDetailResponse::class))]),
        ApiResponse(responseCode = "400", description = "ID·공개 범위 입력 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 또는 CSRF 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "404", description = "게시글 없음", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun publish(@PathVariable("id") id: Long, @RequestBody request: PostVisibilityRequest): ResponseEntity<PostDetailResponse>

    /**
     * 출간을 철회하되 최초 출간 시각을 유지.
     *
     * @param id 양수 게시글 ID
     * @return 초안 상태 [PostDetailResponse]
     */
    @PostMapping("/{id}/unpublish", produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 게시글 출간 철회", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = PostDetailResponse::class))]),
        ApiResponse(responseCode = "400", description = "ID 입력 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 또는 CSRF 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "404", description = "게시글 없음", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun unpublish(@PathVariable("id") id: Long): ResponseEntity<PostDetailResponse>

    /**
     * 게시글의 출간 상태와 최초 출간 시각을 유지하며 범위만 변경.
     *
     * @param id 양수 게시글 ID
     * @param request 필수 새 공개 범위
     * @return 변경된 [PostDetailResponse]
     */
    @PatchMapping("/{id}/visibility", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 게시글 공개 범위 변경", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = PostDetailResponse::class))]),
        ApiResponse(responseCode = "400", description = "ID·공개 범위 입력 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 또는 CSRF 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "404", description = "게시글 없음", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun visibility(@PathVariable("id") id: Long, @RequestBody request: PostVisibilityRequest): ResponseEntity<PostDetailResponse>

    /**
     * 명시적 null 분류 해제와 문자열 태그 배열의 전체 교체를 한 트랜잭션에서 수행.
     *
     * @param id 양수 게시글 ID
     * @param request 누락·타입을 직접 검증할 JSON 객체
     * @return 새 분류·태그를 포함한 [PostDetailResponse]
     */
    @PatchMapping("/{id}/taxonomy", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 게시글 분류·태그 전체 교체", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = PostDetailResponse::class))]),
        ApiResponse(responseCode = "400", description = "ID·JSON 타입·태그 입력 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 또는 CSRF 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "404", description = "게시글 또는 분류 없음", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "409", description = "동시 분류 참조 충돌", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 연결 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun taxonomy(
        @PathVariable("id") id: Long,
        @RequestBody @io.swagger.v3.oas.annotations.parameters.RequestBody(
            required = true,
            content = [Content(schema = Schema(implementation = PostTaxonomyRequest::class))],
        ) request: JsonNode,
    ): ResponseEntity<PostDetailResponse>
}
