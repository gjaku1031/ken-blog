package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.dto.ActivityResponse
import io.github.gjaku1031.kenblog.post.dto.ContentFeedPage
import io.github.gjaku1031.kenblog.post.dto.PinOrderResponse
import io.github.gjaku1031.kenblog.post.service.ContentFeedService
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.JsonNode

/** [ContentFeedService]의 혼합 피드·본문 검색·KST 활동을 공개 읽기 API로 제공. */
@RestController
class ContentFeedController(private val service: ContentFeedService) : ContentFeedApi {
    /** @return 현재 역할과 분류·태그를 적용한 최신 또는 핀 페이지. */
    override fun feed(section: String, sort: String, page: Int, size: Int,
        categoryId: Long?, tag: String?, authentication: Authentication?): ResponseEntity<ContentFeedPage> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.feed(section, sort, page, size, categoryId, tag, authentication))

    /** @return 공개 가능한 Tech·Notes·프로젝트 대문·문서의 검색 결과 [ContentFeedPage]. */
    override fun search(q: String, page: Int, size: Int,
        authentication: Authentication?): ResponseEntity<ContentFeedPage> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore()).body(service.search(q, page, size, authentication))

    /** @return 지정 개월 수의 매 KST 날짜 출간 수. */
    override fun activity(months: Int,
        authentication: Authentication?): ResponseEntity<ActivityResponse> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore()).body(service.activity(months, authentication))
}

/** ADMIN 세션에서 전역 핀 순서 전체를 원자적으로 교체. */
@RestController
class AdminPinController(private val service: ContentFeedService) : AdminPinApi {
    /** @return 현재 저장된 핀 ID 순서. */
    override fun list(): ResponseEntity<PinOrderResponse> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore()).body(service.pins())

    /** @return 중복·누락·본문 외 섹션을 거부한 전체 순열. */
    override fun replace(request: JsonNode): ResponseEntity<PinOrderResponse> {
        val values = request.get("postIds")
        if (!request.isObject || values == null || !values.isArray || values.size() > 1000)
            throw InvalidPostRequestException()
        val ids = (0 until values.size()).map { index ->
            val value = values.get(index)
            if (!value.isIntegralNumber || !value.canConvertToLong() || value.longValue() <= 0)
                throw InvalidPostRequestException()
            value.longValue()
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.replacePins(ids))
    }
}
