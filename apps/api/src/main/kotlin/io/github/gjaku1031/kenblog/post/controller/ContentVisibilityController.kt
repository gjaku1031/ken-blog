package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PostVisibilityRequest
import io.github.gjaku1031.kenblog.post.service.ContentVisibilityService
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController

/** [ContentVisibilityService.change]의 관리자 PATCH 응답을 캐시 없이 제공. */
@RestController
class ContentVisibilityController(private val service: ContentVisibilityService) : ContentVisibilityApi {
    /** @return 변경된 공개 범위와 HOME 프로젝트 메타데이터가 포함된 [PostDetailResponse]. */
    override fun change(id: Long, request: PostVisibilityRequest): ResponseEntity<PostDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.change(id, request.selectedVisibility()))
}
