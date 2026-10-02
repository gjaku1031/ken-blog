package io.github.gjaku1031.kenblog.attachment.controller

import io.github.gjaku1031.kenblog.attachment.service.PostAttachmentDeliveryService
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/**
 * 공개 첨부 요청을 권한 확인·파일 스트리밍에 연결
 */
@RestController
@RequestMapping("/api/v1/posts/{postId}/attachments")
class PostAttachmentController(
    /**
     * 첨부 전달 서비스
     */
    private val service: PostAttachmentDeliveryService
) {
    /**
     * 권한 확인 후 이미지 헤더와 본문 전송
     *
     * 같은 요청 스레드에서 전송하고 입력 스트림 닫음
     *
     * 1. 헤더 확정 전에 권한 확인과 파일 열기
     * 2. 전송 종료·실패 시에도 입력 스트림 해제
     * 3. 현재 요청 스레드에서 본문 전송
     */
    @GetMapping("/{id}/content", produces = [MediaType.IMAGE_JPEG_VALUE, MediaType.IMAGE_PNG_VALUE])
    fun content(
        @PathVariable("postId") postId: Long,
        @PathVariable("id") id: Long,
        response: HttpServletResponse,
    ) {
        // 헤더 확정 전에 권한 확인과 파일 열기
        val content = service.open(postId, id)
        // 전송 종료·실패 시에도 입력 스트림 해제
        content.stream.use { stream ->
            response.contentType = content.contentType
            response.setContentLengthLong(content.byteSize)
            response.setHeader(HttpHeaders.CONTENT_DISPOSITION, "inline")
            response.setHeader("X-Content-Type-Options", "nosniff")
            response.setHeader(HttpHeaders.CACHE_CONTROL, "private, no-store")
            // 현재 요청 스레드에서 본문 전송
            stream.copyTo(response.outputStream)
        }
    }
}
