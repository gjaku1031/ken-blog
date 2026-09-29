package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.domain.InvalidWikiLinkRequestException
import io.github.gjaku1031.kenblog.post.dto.WikiLinkResolveResponse
import io.github.gjaku1031.kenblog.post.service.WikiLinkService
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.RestController

/** Servlet의 반복 원본 값을 [WikiLinkService]에 전달하는 공개 조회 컨트롤러. */
@RestController
class WikiLinkController(private val service: WikiLinkService) : WikiLinkApi {
    /** 미지 쿼리 키를 거부하고 쉼표를 보존한 title 배열을 no-store 결과로 변환. */
    override fun resolve(request: HttpServletRequest, authentication: Authentication?): ResponseEntity<WikiLinkResolveResponse> {
        val parameters = request.parameterMap
        if (parameters.keys != setOf("title")) throw InvalidWikiLinkRequestException()
        val titles = request.getParameterValues("title")?.toList() ?: throw InvalidWikiLinkRequestException()
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.resolve(titles, request.queryString, authentication))
    }
}
