package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.PostViewResponse
import io.github.gjaku1031.kenblog.post.service.PostViewService
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController

/** [PostViewService]의 세션 중복 제거를 CSRF 보호 POST와 연결. */
@RestController
class PostViewController(private val service: PostViewService) : PostViewApi {
    /** @return 관리자·봇·중복을 제외한 조회 수. */
    override fun record(id: Long, authentication: Authentication?, request: HttpServletRequest): ResponseEntity<PostViewResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.record(id, authentication, request))
}
