package io.github.gjaku1031.kenblog.attachment.controller;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.attachment.service.PostAttachmentDeliveryService;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;

/**
 * 공개 첨부 요청의 권한 확인·동기 파일 전송
 */
@RestController
@RequestMapping("/api/v1/posts/{postId}/attachments")
@RequiredArgsConstructor
public final class PostAttachmentController {
    /**
     * 첨부 전달 서비스
     */
    private final PostAttachmentDeliveryService service;

    /**
     * 헤더 확정 전 파일을 열고 같은 요청 스레드에서 전송, 성공·실패 모두 스트림 해제
     */
    @GetMapping(
            value = "/{id}/content",
            produces = {MediaType.IMAGE_JPEG_VALUE, MediaType.IMAGE_PNG_VALUE})
    public void content(
            @PathVariable("postId") long postId,
            @PathVariable("id") long id,
            HttpServletResponse response)
            throws IOException {
        var content = service.open(postId, id);
        try (var stream = content.stream()) {
            response.setContentType(content.contentType());
            response.setContentLengthLong(content.byteSize());
            response.setHeader(HttpHeaders.CONTENT_DISPOSITION, "inline");
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.setHeader(HttpHeaders.CACHE_CONTROL, "private, no-store");
            stream.transferTo(response.getOutputStream());
        }
    }
}
