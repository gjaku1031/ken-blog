package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.PostTodoRequests
import io.github.gjaku1031.kenblog.post.dto.PostTodoResponse
import io.github.gjaku1031.kenblog.post.service.PostTodoService
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.JsonNode

/** [PostTodoService]의 본문 해시 조건을 ADMIN PATCH로 노출. */
@RestController
class PostTodoController(private val service: PostTodoService) : PostTodoApi {
    /** @return 변경된 Markdown 원문과 다음 변경에 필요한 SHA-256. */
    override fun toggle(id: Long, request: JsonNode): ResponseEntity<PostTodoResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.toggle(id, PostTodoRequests.parse(request)))
}
