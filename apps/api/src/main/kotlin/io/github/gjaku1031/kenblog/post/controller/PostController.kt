package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PostPageResponse
import io.github.gjaku1031.kenblog.post.dto.PostWriteRequest
import io.github.gjaku1031.kenblog.post.dto.PostVisibilityRequest
import io.github.gjaku1031.kenblog.post.service.PostService
import java.net.URI
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController

/** [PostApi]의 관리자 HTTP 계약을 [PostService]와 공개 DTO에 연결. */
@RestController
class PostController(private val service: PostService) : PostApi {
    /**
     * 역직렬화된 필수 세 필드를 기존 [PostService.createDraft]로 저장.
     *
     * @param request 전체 초안 입력
     * @return Location과 no-store를 가진 HTTP 201 상세 응답
     */
    override fun create(request: PostWriteRequest): ResponseEntity<PostDetailResponse> {
        val response = service.createDraft(request.title, request.slug, request.body).detail()
        return ResponseEntity.created(URI.create("/api/v1/admin/posts/${response.id}"))
            .cacheControl(CacheControl.noStore()).body(response)
    }

    /**
     * 본문을 제외한 고정 정렬 페이지를 반환.
     *
     * @param page 0 기반 페이지 번호
     * @param size 1~100 페이지 크기
     * @return no-store [PostPageResponse]
     */
    override fun list(page: Int, size: Int): ResponseEntity<PostPageResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.listDrafts(page, size))

    /**
     * 양수 ID의 초안·출간 원문을 상세 DTO로 변환.
     *
     * @param id 조회할 게시글 ID
     * @return no-store 상세 응답
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 행이 없을 때
     */
    override fun detail(id: Long): ResponseEntity<PostDetailResponse> {
        if (id <= 0) throw InvalidPostRequestException()
        val post = service.findById(id) ?: throw PostNotFoundException()
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(post.detail())
    }

    /**
     * 필수 세 필드로 기존 게시글 내용을 원자적으로 전체 교체.
     *
     * @param id 수정할 게시글 ID
     * @param request 새 제목·slug·본문
     * @return no-store 상세 응답
     */
    override fun update(id: Long, request: PostWriteRequest): ResponseEntity<PostDetailResponse> {
        if (id <= 0) throw InvalidPostRequestException()
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.updateDraft(id, request.title, request.slug, request.body).detail())
    }

    /**
     * 게시글 행을 삭제하고 재조회 시 404가 되게 함.
     *
     * @param id 삭제할 게시글 ID
     * @return no-store HTTP 204
     */
    override fun delete(id: Long): ResponseEntity<Void> {
        service.deleteDraft(id)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }

    /**
     * 행 잠금 안에서 출간하고 최초 출간 시각을 포함한 관리자 상세를 반환.
     *
     * @param id 게시글 ID
     * @param request 필수 공개 범위
     * @return no-store 상세 응답
     */
    override fun publish(id: Long, request: PostVisibilityRequest): ResponseEntity<PostDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.publish(id, request.selectedVisibility()).detail())

    /**
     * 초안으로 철회하되 최초 출간 시각을 보존.
     *
     * @param id 게시글 ID
     * @return no-store 상세 응답
     */
    override fun unpublish(id: Long): ResponseEntity<PostDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.unpublish(id).detail())

    /**
     * 출간 상태를 유지하며 공개 범위만 변경.
     *
     * @param id 게시글 ID
     * @param request 필수 새 공개 범위
     * @return no-store 상세 응답
     */
    override fun visibility(id: Long, request: PostVisibilityRequest): ResponseEntity<PostDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.changeVisibility(id, request.selectedVisibility()).detail())

    /** @return JPA 객체를 포함하지 않는 관리자 [PostDetailResponse]. */
    private fun PostEntity.detail(): PostDetailResponse = PostDetailResponse(
        id ?: error("Persisted post has no ID"), title, slug, body, createdAt, updatedAt, status, visibility, publishedAt,
    )
}
