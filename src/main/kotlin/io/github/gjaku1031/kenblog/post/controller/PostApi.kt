package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PostPageResponse
import io.github.gjaku1031.kenblog.post.dto.WikiTitleSearchResponse
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import tools.jackson.databind.JsonNode

/** 웹에서는 본문 작성 없이 목록 조회와 메타데이터만 관리하는 계약. */
@RequestMapping("/api/v1/admin/posts")
interface PostApi {
    /** 운영 도구의 제목 연결 조회. 본문 편집은 제공하지 않음. */
    @GetMapping("/wiki-titles", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun titleSearch(request: HttpServletRequest): ResponseEntity<WikiTitleSearchResponse>

    /** 원문 해시를 확인한 뒤 링크 선언 메타데이터만 보정. */
    @PutMapping("/{id}/wiki-links", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    fun wikiLinks(@PathVariable id: Long, @RequestBody request: JsonNode): ResponseEntity<PostDetailResponse>

    /** 본문 없는 관리자 목록 페이지. */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    fun list(@RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") size: Int): ResponseEntity<PostPageResponse>

    /** MCP·운영 확인에 사용할 원고 상세 읽기. 쓰기 계약은 제공하지 않음. */
    @GetMapping("/{id}", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun detail(@PathVariable id: Long): ResponseEntity<PostDetailResponse>

    /** 본문 필드를 받지 않고 제목·요약·분류·태그만 변경. */
    @PatchMapping("/{id}/metadata", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    fun metadata(@PathVariable id: Long, @RequestBody request: JsonNode): ResponseEntity<PostDetailResponse>
}
