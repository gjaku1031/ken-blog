package io.github.gjaku1031.kenblog.attachment.controller;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.attachment.service.PostAttachmentDeliveryService;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;

/**
 * 공개하지 않은 글의 본문 이미지를 관리자에게만 전달
 */
@RestController
@RequestMapping("/api/v1/admin/posts/{postId}/attachments")
@RequiredArgsConstructor
public final class AdminPostAttachmentController {
    /**
     * 첨부 전달 서비스
     */
    private final PostAttachmentDeliveryService service;

    /**
     * 글 상태와 관계없이 연결된 첨부를 같은 요청 스레드에서 전송, 성공·실패 모두 스트림 해제
     *
     * 관리자 권한은 보안 필터가 검사하며 응답은 브라우저·중간 캐시에 저장하지 않음
     */
    @GetMapping(
            value = "/{id}/content",
            produces = {MediaType.IMAGE_JPEG_VALUE, MediaType.IMAGE_PNG_VALUE})
    public void content(
            @PathVariable("postId") long postId,
            @PathVariable("id") long id,
            HttpServletResponse response)
            throws IOException {
        var content = service.open(postId, id, false);
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
