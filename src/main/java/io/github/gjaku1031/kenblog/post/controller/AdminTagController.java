package io.github.gjaku1031.kenblog.post.controller;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.post.dto.TagCountResponse;
import io.github.gjaku1031.kenblog.post.service.PostService;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * 관리자 태그 사용량 조회
 */
@RestController
@RequestMapping("/api/v1/admin/tags")
@RequiredArgsConstructor
public final class AdminTagController {
    /**
     * 게시글 서비스
     */
    private final PostService service;

    /**
     * 초안 포함 태그 사용량과 no-store 응답
     */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<TagCountResponse>> list() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminTags());
    }
}
