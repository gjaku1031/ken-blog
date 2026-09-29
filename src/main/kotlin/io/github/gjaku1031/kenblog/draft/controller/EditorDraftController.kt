package io.github.gjaku1031.kenblog.draft.controller

import io.github.gjaku1031.kenblog.draft.dto.EditorDraftDetailResponse
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftPageResponse
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftRequests
import io.github.gjaku1031.kenblog.draft.service.EditorDraftService
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import java.net.URI
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.JsonNode

/** [EditorDraftApi]의 엄격 JSON 파싱·no-store HTTP 응답을 구체 서비스와 연결. */
@RestController
class EditorDraftController(private val service: EditorDraftService) : EditorDraftApi {
    /** @return 생성된 편집본의 관리자 Location과 no-store HTTP 201. */
    override fun create(request: JsonNode): ResponseEntity<EditorDraftDetailResponse> {
        val created = service.create(EditorDraftRequests.create(request))
        return ResponseEntity.created(URI.create("/api/v1/admin/editor-drafts/${created.id}"))
            .cacheControl(CacheControl.noStore()).body(created)
    }

    /** @return 본문 없는 no-store 목록과 전체 건수. */
    override fun list(page: Int, size: Int, postId: Long?): ResponseEntity<EditorDraftPageResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.list(page, size, postId))

    /** @return 원문 편집본을 가진 no-store 상세. */
    override fun detail(id: Long): ResponseEntity<EditorDraftDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.detail(id))

    /** @return revision 검사와 전체 저장을 마친 no-store 상세. */
    override fun update(id: Long, request: JsonNode): ResponseEntity<EditorDraftDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.update(id, EditorDraftRequests.update(request)))

    /** @return 공개 원문을 변경하지 않은 편집본 삭제 HTTP 204. */
    override fun delete(id: Long, revision: Long): ResponseEntity<Void> {
        service.delete(id, revision)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }

    /** @return 같은 트랜잭션에서 원문·분류·태그·범위를 반영한 no-store 게시글 상세. */
    override fun publish(id: Long, request: JsonNode): ResponseEntity<PostDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.publish(id, EditorDraftRequests.publish(request).revision))
}
