package io.github.gjaku1031.kenblog.attachment.controller

import io.github.gjaku1031.kenblog.attachment.service.PostAttachmentDeliveryService
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody

/** [PostAttachmentApi]를 현재 DB 권한 조회와 OCI 스트리밍에 연결. */
@RestController
class PostAttachmentController(private val service: PostAttachmentDeliveryService) : PostAttachmentApi {
    /** 헤더 확정 전 OCI 입력을 열고 내부 key·원본 이름·계정을 제외한 안전한 헤더만 반환. */
    override fun content(postId: Long, id: Long, authentication: Authentication?): ResponseEntity<StreamingResponseBody> {
        val content = service.open(postId, id, authentication)
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(content.contentType))
            .contentLength(content.byteSize)
            .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
            .header("X-Content-Type-Options", "nosniff")
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .body(StreamingResponseBody { output -> content.stream.use { it.copyTo(output) } })
    }
}
