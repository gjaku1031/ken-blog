package io.github.gjaku1031.kenblog.stack.controller

import io.github.gjaku1031.kenblog.stack.dto.RenameStackBadgeRequest
import io.github.gjaku1031.kenblog.stack.dto.StackBadgeResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody

/** 공개 기술 뱃지와 관리자 레지스트리의 HTTP/OpenAPI 계약. */
interface StackBadgeApi {
    /** @return 비공개 사용 수를 제외한 공개 목록. */
    @GetMapping("/api/v1/stack-badges")
    @Operation(summary = "공개 기술 뱃지 목록")
    fun list(): List<StackBadgeResponse>

    /** @return OCI에 저장된 정규화 PNG. */
    @GetMapping("/api/v1/stack-badges/{id}/image", produces = [MediaType.IMAGE_PNG_VALUE])
    @Operation(summary = "공개 기술 뱃지 PNG")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "404"), ApiResponse(responseCode = "503")])
    fun image(@PathVariable id: Long): ResponseEntity<StreamingResponseBody>

    /** @return 전체 사용 수를 포함한 관리자 목록. */
    @GetMapping("/api/v1/admin/stack-badges")
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "관리자 기술 뱃지 목록")
    fun listAdmin(): List<StackBadgeResponse>

    /** @return 64×64 PNG 변환과 OCI 저장을 마친 뱃지. */
    @PostMapping("/api/v1/admin/stack-badges", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "기술 뱃지 등록")
    @ApiResponses(value = [ApiResponse(responseCode = "201"), ApiResponse(responseCode = "400"), ApiResponse(responseCode = "409"), ApiResponse(responseCode = "415"), ApiResponse(responseCode = "503")])
    fun create(@RequestParam name: String, @RequestParam file: MultipartFile): ResponseEntity<StackBadgeResponse>

    /** @return 프로젝트 ID 연결을 유지하며 이름만 바뀐 뱃지. */
    @PutMapping("/api/v1/admin/stack-badges/{id}")
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "기술 뱃지 이름 수정")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400"), ApiResponse(responseCode = "404"), ApiResponse(responseCode = "409")])
    fun rename(@PathVariable id: Long, @RequestBody body: RenameStackBadgeRequest): StackBadgeResponse

    /** @return 새 PNG key와 버전 URL이 적용된 뱃지. */
    @PostMapping("/api/v1/admin/stack-badges/{id}/image", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "기술 뱃지 이미지 교체")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "404"), ApiResponse(responseCode = "415"), ApiResponse(responseCode = "503")])
    fun replaceImage(@PathVariable id: Long, @RequestParam file: MultipartFile): StackBadgeResponse

    /** @return 프로젝트 연결도 제거한 HTTP 204. */
    @DeleteMapping("/api/v1/admin/stack-badges/{id}")
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "기술 뱃지 삭제")
    @ApiResponses(value = [ApiResponse(responseCode = "204"), ApiResponse(responseCode = "404")])
    fun delete(@PathVariable id: Long): ResponseEntity<Void>
}
