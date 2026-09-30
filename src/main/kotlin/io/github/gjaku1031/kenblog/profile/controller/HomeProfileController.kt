package io.github.gjaku1031.kenblog.profile.controller

import io.github.gjaku1031.kenblog.profile.dto.HomeProfileRequest
import io.github.gjaku1031.kenblog.profile.dto.HomeProfileResponse
import io.github.gjaku1031.kenblog.profile.service.HomeProfileService
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody

/** 공개 홈 카드 조회와 관리자 소개·사진 편집을 [HomeProfileService]에 연결. */
@RestController
class HomeProfileController(private val service: HomeProfileService) {
    /** @return 저장된 소개나 빈 카드. */
    @GetMapping("/api/v1/profile")
    fun get(): HomeProfileResponse = service.get()

    /** @return 공개 PNG 사진 스트림. */
    @GetMapping("/api/v1/profile/photo", produces = [MediaType.IMAGE_PNG_VALUE])
    fun photo(): ResponseEntity<StreamingResponseBody> {
        val stream = service.openPhoto()
        return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG)
            .header("X-Content-Type-Options", "nosniff")
            .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300")
            .body(StreamingResponseBody { output -> stream.use { it.copyTo(output) } })
    }

    /** @return 저장된 텍스트 소개. */
    @PutMapping("/api/v1/admin/profile")
    fun update(@RequestBody body: HomeProfileRequest): HomeProfileResponse = service.update(body)

    /** @return 텍스트와 선택 사진을 한 번에 확정한 홈 소개. */
    @PostMapping("/api/v1/admin/profile/save", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun save(
        @RequestPart("profile") profile: HomeProfileRequest,
        @RequestPart("file", required = false) file: MultipartFile?,
        @RequestParam(defaultValue = "false") removePhoto: Boolean,
    ): HomeProfileResponse = service.save(profile, file, removePhoto)

    /** @return 256×256 사진이 적용된 소개. */
    @PostMapping("/api/v1/admin/profile/photo", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun upload(@RequestParam file: MultipartFile): HomeProfileResponse = service.uploadPhoto(file)

    /** @return 사진 참조가 제거된 소개. */
    @DeleteMapping("/api/v1/admin/profile/photo")
    fun delete(): HomeProfileResponse = service.removePhoto()
}
