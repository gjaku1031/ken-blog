package io.github.gjaku1031.kenblog.category.controller

import io.github.gjaku1031.kenblog.category.dto.CategoryTreeResponse
import io.github.gjaku1031.kenblog.category.service.CategoryService
import org.springframework.http.CacheControl
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** [PublicCategoryController] 조회를 역할별 SQL 집계와 연결. */
@RestController
@RequestMapping("/api/v1/categories")
class PublicCategoryController(private val service: CategoryService) {
    /** @return 현재 권한의 건수만 가진 no-store 분류 트리. */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    fun list(authentication: Authentication?): ResponseEntity<List<CategoryTreeResponse>> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.tree(admin = false, authentication = authentication))
}
