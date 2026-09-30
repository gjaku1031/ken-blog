package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.ContentFeedPage
import io.github.gjaku1031.kenblog.post.service.ContentFeedService
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** [ContentFeedService]의 PUBLIC 혼합 피드·본문 검색을 제공. */
@RestController
class ContentFeedController(private val service: ContentFeedService) {
    /** @return 분류·태그를 적용한 최신 페이지. */
    @GetMapping("/api/v1/feed")
    fun feed(@RequestParam(defaultValue = "all") section: String,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "10") size: Int,
        @RequestParam(required = false) categoryId: Long?,
        @RequestParam(required = false) tag: String?, authentication: Authentication?): ResponseEntity<ContentFeedPage> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.feed(section, page, size, categoryId, tag, authentication))

    /** @return 공개 가능한 Tech·Notes·프로젝트 대문·문서의 검색 결과 [ContentFeedPage]. */
    @GetMapping("/api/v1/search")
    fun search(@RequestParam q: String, @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "10") size: Int,
        authentication: Authentication?): ResponseEntity<ContentFeedPage> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore()).body(service.search(q, page, size, authentication))
}
