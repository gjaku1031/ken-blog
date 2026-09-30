package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.PublicPostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PublicPostPageResponse
import io.github.gjaku1031.kenblog.post.dto.WikiBacklinkPageResponse
import io.github.gjaku1031.kenblog.post.service.PublicPostService
import io.github.gjaku1031.kenblog.post.service.WikiNavigationService
import org.springframework.http.CacheControl
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** [PublicPostController] 요청을 권한별 [PublicPostService] 조회에 연결. */
@RestController
@RequestMapping("/api/v1/posts")
class PublicPostController(private val service: PublicPostService, private val navigation: WikiNavigationService) {
    /** @return 현재 권한과 대상 제목 대표 여부를 검증한 no-store 역링크 페이지. */
    @GetMapping("/{slug}/backlinks", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun backlinks(
        @PathVariable("slug") slug: String,
        @RequestParam(defaultValue = "0") page: Int,
        authentication: Authentication?,
    ): ResponseEntity<WikiBacklinkPageResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(navigation.backlinks(slug, page, authentication))

    /**
     * 비관리자와 관리자 세션의 목록 필터를 서비스에 전달.
     *
     * @param page 0 기반 페이지 번호
     * @param size 페이지 크기
     * @param categoryId 분류·하위 분류 필터
     * @param tag 정확 일치 태그 필터
     * @param authentication 현재 인증 또는 익명 토큰
     * @return no-store 공개 목록
     */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    fun list(
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "10") size: Int,
        @RequestParam(required = false) categoryId: Long?,
        @RequestParam(required = false) tag: String?,
        authentication: Authentication?,
    ): ResponseEntity<PublicPostPageResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.list(page, size, authentication, categoryId, tag))

    /**
     * 출간 slug를 조회해 허용 본문 또는 비관리자 잠금 상세를 반환.
     *
     * @param slug 게시글 주소
     * @param authentication 현재 인증 또는 익명 토큰
     * @return no-store 공개 상세
     */
    @GetMapping("/{slug}", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun detail(@PathVariable("slug") slug: String, authentication: Authentication?): ResponseEntity<PublicPostDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.detail(slug, authentication))
}
