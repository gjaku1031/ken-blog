package io.github.gjaku1031.kenblog.profile.controller

import io.github.gjaku1031.kenblog.profile.dto.HomeProfileRequest
import io.github.gjaku1031.kenblog.profile.dto.HomeProfileResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody

/** 공개 홈 소개 조회와 관리자 편집의 HTTP/OpenAPI 계약. */
interface HomeProfileApi {
    /** @return 공개 홈 카드. */
    @GetMapping("/api/v1/profile")
    @Operation(summary = "홈 소개 조회")
    fun get(): HomeProfileResponse

    /** @return OCI 프로필 사진 PNG. */
    @GetMapping("/api/v1/profile/photo", produces = [MediaType.IMAGE_PNG_VALUE])
    @Operation(summary = "홈 소개 사진")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "404"), ApiResponse(responseCode = "503")])
    fun photo(): ResponseEntity<StreamingResponseBody>

    /** @return 사진을 유지하고 텍스트만 저장한 카드. */
    @PutMapping("/api/v1/admin/profile")
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "홈 소개 텍스트 수정")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400")])
    fun update(@RequestBody body: HomeProfileRequest): HomeProfileResponse

    /** @return 텍스트·사진을 한 트랜잭션에 저장한 카드. */
    @PostMapping("/api/v1/admin/profile/save", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "홈 소개와 사진 함께 저장")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400"), ApiResponse(responseCode = "415"), ApiResponse(responseCode = "503")])
    fun save(@RequestPart("profile") profile: HomeProfileRequest,
             @RequestPart("file", required = false) file: MultipartFile?,
             @RequestParam(defaultValue = "false") removePhoto: Boolean): HomeProfileResponse

    /** @return 사진만 교체한 카드. */
    @PostMapping("/api/v1/admin/profile/photo", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "홈 소개 사진 교체")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "415"), ApiResponse(responseCode = "503")])
    fun upload(@RequestParam file: MultipartFile): HomeProfileResponse

    /** @return 사진 참조를 제거한 카드. */
    @DeleteMapping("/api/v1/admin/profile/photo")
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "홈 소개 사진 삭제")
    fun delete(): HomeProfileResponse
}
