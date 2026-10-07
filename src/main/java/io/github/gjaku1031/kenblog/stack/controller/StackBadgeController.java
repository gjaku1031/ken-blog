package io.github.gjaku1031.kenblog.stack.controller;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.stack.dto.StackBadgeResponse;
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.*;

/**
 * 관리자 기술 목록과 공개 아이콘 조회
 */
@RestController
@RequiredArgsConstructor
public final class StackBadgeController {
    /**
     * 기술 뱃지 서비스
     */
    private final StackBadgeService service;

    /**
     * 프로젝트 선택용 등록 기술 목록
     */
    @GetMapping("/api/v1/admin/stack-badges")
    public List<StackBadgeResponse> listAdmin() {
        return service.listAdmin();
    }

    /**
     * 경로 검사 후 같은 요청 스레드에서 PNG 전송·입력 스트림 종료
     */
    @GetMapping(value = "/api/v1/stack-badges/{id}/image", produces = MediaType.IMAGE_PNG_VALUE)
    public void image(@PathVariable long id, HttpServletResponse response) throws IOException {
        try (var stream = service.openImage(id)) {
            response.setContentType(MediaType.IMAGE_PNG_VALUE);
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.setHeader(HttpHeaders.CACHE_CONTROL, "public, max-age=300");
            stream.transferTo(response.getOutputStream());
        }
    }
}
