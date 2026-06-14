package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.PublicPostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PublicPostPageResponse
import io.github.gjaku1031.kenblog.post.service.PublicPostService
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.RestController

/** [PublicPostApi] 요청을 권한별 [PublicPostService] 조회에 연결. */
@RestController
class PublicPostController(private val service: PublicPostService) : PublicPostApi {
    /**
     * 익명과 로그인 세션의 목록 필터를 서비스에 전달.
     *
     * @param page 0 기반 페이지 번호
     * @param size 페이지 크기
     * @param categoryId 분류·하위 분류 필터
     * @param tag 정확 일치 태그 필터
     * @param authentication 현재 인증 또는 익명 토큰
     * @return no-store 공개 목록
     */
    override fun list(page: Int, size: Int, categoryId: Long?, tag: String?, authentication: Authentication?): ResponseEntity<PublicPostPageResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.list(page, size, authentication, categoryId, tag))

    /**
     * 출간 slug를 조회해 허용 본문 또는 익명 잠금 상세를 반환.
     *
     * @param slug 게시글 주소
     * @param authentication 현재 인증 또는 익명 토큰
     * @return no-store 공개 상세
     */
    override fun detail(slug: String, authentication: Authentication?): ResponseEntity<PublicPostDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.detail(slug, authentication))
}
