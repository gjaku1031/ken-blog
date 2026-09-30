package io.github.gjaku1031.kenblog.category.controller

import io.github.gjaku1031.kenblog.category.dto.CategoryCreateRequest
import io.github.gjaku1031.kenblog.category.dto.CategoryOrderRequest
import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.category.dto.CategoryTreeResponse
import io.github.gjaku1031.kenblog.category.service.CategoryService
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.JsonNode

/** [AdminCategoryController] 계약을 트랜잭션 분류 서비스에 연결. */
@RestController
@RequestMapping("/api/v1/admin/categories")
class AdminCategoryController(private val service: CategoryService) {
    /** @return 엄격한 문자열 경로 생성 결과와 no-store HTTP 201. */
    @PostMapping(consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    fun create(
        @RequestBody request: JsonNode,
    ): ResponseEntity<CategoryRefResponse> =
        ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
            .body(service.create(CategoryCreateRequest.fromJson(request).path))

    /** @return 초안 포함 직접·하위 글 수 트리와 no-store HTTP 200. */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    fun list(): ResponseEntity<List<CategoryTreeResponse>> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.tree(admin = true, authentication = null))

    /** @return 변경된 숫자 순서를 포함한 no-store 참조. */
    @PutMapping("/{id}/order", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    fun setOrder(@PathVariable("id") id: Long, @RequestBody request: CategoryOrderRequest): ResponseEntity<CategoryRefResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.setOrder(id, request.order))

    /** @return 글을 부모로 이동한 뒤 분류만 삭제한 no-store HTTP 204. */
    @DeleteMapping("/{id}")
    fun delete(@PathVariable("id") id: Long): ResponseEntity<Void> {
        service.delete(id)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }
}
