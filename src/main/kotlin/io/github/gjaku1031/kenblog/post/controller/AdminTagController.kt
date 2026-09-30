package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.TagCountResponse
import io.github.gjaku1031.kenblog.post.service.PostService
import org.springframework.http.CacheControl
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** [AdminTagController]의 관리자 전용 집계를 구체 [PostService]에 연결. */
@RestController
@RequestMapping("/api/v1/admin/tags")
class AdminTagController(private val service: PostService) {
    /** @return 초안 포함 태그 사용량과 no-store HTTP 200. */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    fun list(): ResponseEntity<List<TagCountResponse>> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminTags())
}
