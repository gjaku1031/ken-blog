package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.TagCountResponse
import io.github.gjaku1031.kenblog.post.service.PublicPostService
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.RestController

/** [PublicTagApi]를 역할별 [PublicPostService] SQL 집계에 연결. */
@RestController
class PublicTagController(private val service: PublicPostService) : PublicTagApi {
    /** @return 현재 공개 권한의 태그 사용량과 no-store HTTP 200. */
    override fun list(authentication: Authentication?): ResponseEntity<List<TagCountResponse>> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.tags(authentication))
}
