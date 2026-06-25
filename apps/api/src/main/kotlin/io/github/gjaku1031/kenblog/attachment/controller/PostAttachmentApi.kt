package io.github.gjaku1031.kenblog.attachment.controller

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
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody

/** 글 ID 문맥에서만 허용하는 비공개 저장소 이미지의 HTTP/OpenAPI 계약. */
@RequestMapping("/api/v1/posts/{postId}/attachments")
interface PostAttachmentApi {
    /** @return 현재 글 권한과 연결이 확인된 JPEG/PNG 본문 또는 안전한 문제 상태. */
    @GetMapping("/{id}/content", produces = [MediaType.IMAGE_JPEG_VALUE, MediaType.IMAGE_PNG_VALUE])
    @Operation(summary = "글에 연결된 이미지 읽기")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", description = "현재 권한에서 열람 가능한 JPEG 또는 PNG"),
        ApiResponse(responseCode = "404", description = "글·연결·첨부 부재 또는 열람 불가", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 또는 비공개 저장소 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun content(
        @PathVariable("postId") postId: Long,
        @PathVariable("id") id: Long,
        @Parameter(hidden = true) authentication: Authentication?,
    ): ResponseEntity<StreamingResponseBody>
}
