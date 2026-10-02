package io.github.gjaku1031.kenblog.series.controller

import io.github.gjaku1031.kenblog.series.service.SeriesService
import io.github.gjaku1031.kenblog.series.dto.SeriesRequests
import io.github.gjaku1031.kenblog.series.domain.InvalidSeriesRequestException
import org.springframework.web.bind.annotation.*
import org.springframework.http.ResponseEntity
import org.springframework.http.CacheControl
import tools.jackson.databind.JsonNode

/**
 * 관리자 시리즈 메타데이터 API. 본문 입력은 제공하지 않음
 */
@RestController
@RequestMapping("/api/v1/admin/series")
class SeriesController(
    /**
     * 시리즈 서비스
     */
    private val service: SeriesService
) {
    /**
     * 시리즈 목록 조회
     */
    @GetMapping
    fun list() = noStore(service.list(true))

    /**
     * 시리즈 상세와 문서 목록 조회
     */
    @GetMapping("/{id}")
    fun detail(@PathVariable id: Long) = noStore(service.detail(id))

    /**
     * 시리즈 생성
     */
    @PostMapping
    fun create(@RequestBody input: JsonNode) = noStore(service.create(SeriesRequests.create(input)))

    /**
     * 기존 수정 시각을 확인하고 시리즈 속성 변경
     */
    @PutMapping("/{id}/metadata")
    fun update(@PathVariable id: Long, @RequestBody input: JsonNode) =
        noStore(service.update(id, SeriesRequests.metadata(input)))

    /**
     * 시리즈 표시 순서 변경
     */
    @PutMapping("/{id}/order")
    fun order(@PathVariable id: Long, @RequestBody input: JsonNode): ResponseEntity<*> {
        if (!input.isObject || input.size() != 1 || !input.path("order").isIntegralNumber || !input.path("order").canConvertToLong())
            throw InvalidSeriesRequestException()
        return noStore(service.setOrder(id, input.get("order").longValue()))
    }

    /**
     * 문서가 없는 시리즈 삭제
     */
    @DeleteMapping("/{id}")
    fun delete(@PathVariable id: Long): ResponseEntity<Void> {
        service.delete(id); return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }

    /**
     * 캐시 저장을 금지한 HTTP 200 응답 생성
     */
    private fun <T : Any> noStore(value: T): ResponseEntity<T> = ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value)
}
