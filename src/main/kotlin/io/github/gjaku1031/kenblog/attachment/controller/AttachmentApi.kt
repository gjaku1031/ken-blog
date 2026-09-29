package io.github.gjaku1031.kenblog.attachment.controller

import io.github.gjaku1031.kenblog.attachment.dto.AttachmentResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.Parameter
import io.swagger.v3.oas.annotations.enums.ParameterIn
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody

/**
 * 관리자 전용 이미지 업로드·상태 조회·스트리밍·삭제의 HTTP/OpenAPI 계약.
 *
 * [AttachmentController]가 구현하며 기존 세션 역할과 POST·DELETE CSRF 정책을 사용함.
 */
@RequestMapping("/api/v1/admin/attachments")
@SecurityRequirement(name = "sessionCookie")
interface AttachmentApi {
    /**
     * 요청당 한 JPEG 또는 PNG를 검증·저장하고 READY 메타데이터를 반환.
     *
     * @param file `file` multipart 항목
     * @param request 중복 파일 항목 확인에 사용할 요청
     * @param authentication 업로드 계정명을 가진 관리자 세션
     * @return 생성된 [AttachmentResponse]와 HTTP 201
     */
    @PostMapping(consumes = [MediaType.MULTIPART_FORM_DATA_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 이미지 첨부 업로드", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "201", content = [Content(schema = Schema(implementation = AttachmentResponse::class))]),
        ApiResponse(responseCode = "400", description = "파일 이름·요청 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 또는 CSRF 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "409", description = "저장 상태 충돌", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "413", description = "10 MiB 초과", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "415", description = "지원하지 않거나 손상된 이미지", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "저장소 또는 DB 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun upload(
        @RequestPart("file") file: MultipartFile,
        @Parameter(hidden = true) request: HttpServletRequest,
        @Parameter(hidden = true) authentication: Authentication,
    ): ResponseEntity<AttachmentResponse>

    /**
     * 처리 중 상태까지 포함하는 첨부 메타데이터를 반환.
     *
     * @param id 조회할 첨부 ID
     * @return 비공개 key가 없는 [AttachmentResponse]
     */
    @GetMapping("/{id}", produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 첨부 메타데이터 조회")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = AttachmentResponse::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "404", description = "첨부 없음", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "저장소 또는 DB 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun find(@PathVariable id: Long): AttachmentResponse

    /**
     * READY 이미지를 서버에서 비공개 OCI 버킷으로부터 스트리밍.
     *
     * @param id 내려받을 첨부 ID
     * @return 확인된 MIME·길이·안전한 이름의 파일 응답
     */
    @GetMapping("/{id}/content", produces = [MediaType.IMAGE_JPEG_VALUE, MediaType.IMAGE_PNG_VALUE])
    @Operation(summary = "관리자 첨부 원본 다운로드")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", description = "JPEG 또는 PNG 원본 바이트"),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "404", description = "첨부 없음", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "409", description = "READY가 아닌 상태", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "저장소 또는 DB 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun content(@PathVariable id: Long): ResponseEntity<StreamingResponseBody>

    /**
     * 추적 상태를 DELETING으로 남긴 후 객체와 행을 삭제.
     *
     * @param id 삭제할 첨부 ID
     * @return 삭제 요청이 완료된 HTTP 204
     */
    @DeleteMapping("/{id}")
    @Operation(summary = "관리자 첨부 삭제", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true)])
    @ApiResponses(value = [
        ApiResponse(responseCode = "204", description = "객체와 메타데이터 삭제 완료"),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "관리자 권한 또는 CSRF 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "404", description = "첨부 없음", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "409", description = "글·편집본에서 사용 중, 업로드 중 또는 삭제 정리 유예", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "저장소 또는 DB 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun delete(@PathVariable id: Long): ResponseEntity<Void>
}
