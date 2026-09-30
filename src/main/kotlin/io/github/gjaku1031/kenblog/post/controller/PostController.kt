package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.InvalidWikiLinkRequestException
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PostPageResponse
import io.github.gjaku1031.kenblog.post.dto.PostTaxonomyRequest
import io.github.gjaku1031.kenblog.post.dto.WikiLinkCorrectionRequest
import io.github.gjaku1031.kenblog.post.dto.WikiTitleSearchResponse
import io.github.gjaku1031.kenblog.post.service.PostService
import io.github.gjaku1031.kenblog.post.service.WikiNavigationService
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.JsonNode

/** 본문 생성·교체·발행 HTTP를 제거하고 메타데이터만 공통 서비스에 연결. */
@RestController
@RequestMapping("/api/v1/admin/posts")
class PostController(private val service: PostService, private val navigation: WikiNavigationService) {
    /** 운영 도구의 제목 조회 입력을 검증. */
    @GetMapping("/wiki-titles", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun titleSearch(request: HttpServletRequest): ResponseEntity<WikiTitleSearchResponse> {
        val values = request.getParameterValues("q") ?: throw InvalidWikiLinkRequestException()
        if (values.size != 1) throw InvalidWikiLinkRequestException()
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(navigation.titleSearch(values[0]))
    }

    /** 본문은 유지하고 링크 선언만 현재 파일 해시에 맞춰 변경. */
    @PutMapping("/{id}/wiki-links", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    fun wikiLinks(@PathVariable id: Long, @RequestBody request: JsonNode): ResponseEntity<PostDetailResponse> {
        val input = WikiLinkCorrectionRequest.fromJson(request)
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.replaceWikiLinks(id, input.expectedBodySha256, input.wikiTargets))
    }

    /** 저장소 본문을 읽지 않는 관리자 목록. */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    fun list(@RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") size: Int): ResponseEntity<PostPageResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.listDrafts(page, size))

    /** 명시적인 읽기 요청에만 원고 상세를 반환. */
    @GetMapping("/{id}", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun detail(@PathVariable id: Long): ResponseEntity<PostDetailResponse> {
        if (id <= 0) throw InvalidPostRequestException()
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.adminDetail(id))
    }

    /** 본문 입력을 거부하고 메타데이터 필드를 엄격하게 확인. */
    @PatchMapping("/{id}/metadata", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    fun metadata(@PathVariable id: Long, @RequestBody request: JsonNode): ResponseEntity<PostDetailResponse> {
        if (!request.isObject || request.has("body") || !request.path("title").isTextual ||
            !request.path("summary").isTextual) throw InvalidPostRequestException()
        val taxonomy = PostTaxonomyRequest.fromJson(request)
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.updateMetadata(
            id, request.get("title").textValue(), request.get("summary").textValue(), taxonomy.categoryId, taxonomy.tags,
        ))
    }
}
