package io.github.gjaku1031.kenblog.attachment.controller

import io.github.gjaku1031.kenblog.attachment.service.PostAttachmentDeliveryService
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** [PostAttachmentController]를 현재 DB 권한 조회와 로컬 파일 스트리밍에 연결. */
@RestController
@RequestMapping("/api/v1/posts/{postId}/attachments")
class PostAttachmentController(private val service: PostAttachmentDeliveryService) {
    /** 헤더 확정 전 로컬 파일 입력을 열고 내부 key·원본 이름·계정을 제외한 안전한 헤더만 반환. */
    @GetMapping("/{id}/content", produces = [MediaType.IMAGE_JPEG_VALUE, MediaType.IMAGE_PNG_VALUE])
    fun content(
        @PathVariable("postId") postId: Long,
        @PathVariable("id") id: Long,
        response: HttpServletResponse,
    ) {
        val content = service.open(postId, id)
        content.stream.use { stream ->
            response.contentType = content.contentType
            response.setContentLengthLong(content.byteSize)
            response.setHeader(HttpHeaders.CONTENT_DISPOSITION, "inline")
            response.setHeader("X-Content-Type-Options", "nosniff")
            response.setHeader(HttpHeaders.CACHE_CONTROL, "private, no-store")
            stream.copyTo(response.outputStream)
        }
    }
}
