package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.ContentFeedPage
import io.github.gjaku1031.kenblog.post.service.ContentFeedService
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.RestController

/** [ContentFeedService]의 PUBLIC 혼합 피드·본문 검색을 제공. */
@RestController
class ContentFeedController(private val service: ContentFeedService) : ContentFeedApi {
    /** @return 분류·태그를 적용한 최신 페이지. */
    override fun feed(section: String, page: Int, size: Int,
        categoryId: Long?, tag: String?, authentication: Authentication?): ResponseEntity<ContentFeedPage> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.feed(section, page, size, categoryId, tag, authentication))

    /** @return 공개 가능한 Tech·Notes·프로젝트 대문·문서의 검색 결과 [ContentFeedPage]. */
    override fun search(q: String, page: Int, size: Int,
        authentication: Authentication?): ResponseEntity<ContentFeedPage> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore()).body(service.search(q, page, size, authentication))


}
