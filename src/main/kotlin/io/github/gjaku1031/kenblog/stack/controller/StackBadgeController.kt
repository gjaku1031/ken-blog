package io.github.gjaku1031.kenblog.stack.controller

import io.github.gjaku1031.kenblog.stack.dto.RenameStackBadgeRequest
import io.github.gjaku1031.kenblog.stack.dto.StackBadgeResponse
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody

/** 공개 뱃지 목록·아이콘과 관리자 등록·변경·삭제를 [StackBadgeService]에 연결. */
@RestController
class StackBadgeController(private val service: StackBadgeService) : StackBadgeApi {
    /** @return 전체 등록 뱃지와 사용 수. */
    @GetMapping("/api/v1/stack-badges")
    override fun list(): List<StackBadgeResponse> = service.list()

    /** @return 비공개 프로젝트까지 포함한 관리자용 뱃지 사용 수. */
    @GetMapping("/api/v1/admin/stack-badges")
    override fun listAdmin(): List<StackBadgeResponse> = service.listAdmin()

    /** @return OCI PNG 스트림을 닫는 공개 이미지 응답. */
    @GetMapping("/api/v1/stack-badges/{id}/image", produces = [MediaType.IMAGE_PNG_VALUE])
    override fun image(@PathVariable id: Long): ResponseEntity<StreamingResponseBody> {
        val stream = service.openImage(id)
        return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG)
            .header("X-Content-Type-Options", "nosniff")
            .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300")
            .body(StreamingResponseBody { output -> stream.use { it.copyTo(output) } })
    }

    /** @return PNG 저장이 끝난 새 뱃지와 HTTP 201. */
    @PostMapping("/api/v1/admin/stack-badges", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    override fun create(@RequestParam name: String, @RequestParam file: MultipartFile): ResponseEntity<StackBadgeResponse> =
        ResponseEntity.status(201).body(service.create(name, file))

    /** @return 같은 ID로 이름이 바뀐 뱃지. */
    @PutMapping("/api/v1/admin/stack-badges/{id}")
    override fun rename(@PathVariable id: Long, @RequestBody body: RenameStackBadgeRequest): StackBadgeResponse =
        service.rename(id, body.name)

    /** @return 새 아이콘이 적용된 뱃지. */
    @PostMapping("/api/v1/admin/stack-badges/{id}/image", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    override fun replaceImage(@PathVariable id: Long, @RequestParam file: MultipartFile): StackBadgeResponse =
        service.replaceImage(id, file)

    /** @return 삭제 완료 후 HTTP 204. */
    @DeleteMapping("/api/v1/admin/stack-badges/{id}")
    override fun delete(@PathVariable id: Long): ResponseEntity<Void> {
        service.delete(id)
        return ResponseEntity.noContent().build()
    }
}
