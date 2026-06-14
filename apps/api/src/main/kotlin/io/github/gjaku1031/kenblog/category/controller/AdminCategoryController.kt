package io.github.gjaku1031.kenblog.category.controller

import io.github.gjaku1031.kenblog.category.dto.CategoryCreateRequest
import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.category.dto.CategoryTreeResponse
import io.github.gjaku1031.kenblog.category.service.CategoryService
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.JsonNode

/** [AdminCategoryApi] 계약을 트랜잭션 분류 서비스에 연결. */
@RestController
class AdminCategoryController(private val service: CategoryService) : AdminCategoryApi {
    /** @return 엄격한 문자열 경로 생성 결과와 no-store HTTP 201. */
    override fun create(request: JsonNode): ResponseEntity<CategoryRefResponse> =
        ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
            .body(service.create(CategoryCreateRequest.fromJson(request).path))

    /** @return 초안 포함 직접·하위 글 수 트리와 no-store HTTP 200. */
    override fun list(): ResponseEntity<List<CategoryTreeResponse>> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.tree(admin = true, authentication = null))

    /** @return 글을 부모로 이동한 뒤 분류만 삭제한 no-store HTTP 204. */
    override fun delete(id: Long): ResponseEntity<Void> {
        service.delete(id)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }
}
