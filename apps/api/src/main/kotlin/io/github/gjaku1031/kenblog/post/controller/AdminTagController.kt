package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.TagCountResponse
import io.github.gjaku1031.kenblog.post.service.PostService
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController

/** [AdminTagApi]의 관리자 전용 집계를 구체 [PostService]에 연결. */
@RestController
class AdminTagController(private val service: PostService) : AdminTagApi {
    /** @return 초안 포함 태그 사용량과 no-store HTTP 200. */
    override fun list(): ResponseEntity<List<TagCountResponse>> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminTags())
}
