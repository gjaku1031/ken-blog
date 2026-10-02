package io.github.gjaku1031.kenblog.series.controller

import io.github.gjaku1031.kenblog.series.service.SeriesService
import io.github.gjaku1031.kenblog.series.dto.SeriesRequests
import io.github.gjaku1031.kenblog.series.domain.InvalidSeriesRequestException
import org.springframework.web.bind.annotation.*
import org.springframework.http.ResponseEntity
import org.springframework.http.CacheControl
import tools.jackson.databind.JsonNode

/** 관리자 시리즈 메타데이터 API. 본문 입력은 제공하지 않음. */
@RestController
@RequestMapping("/api/v1/admin/series")
class SeriesController(private val service: SeriesService) {
    @GetMapping
    fun list() = noStore(service.list(true))

    @GetMapping("/{id}")
    fun detail(@PathVariable id: Long) = noStore(service.detail(id))

    @PostMapping
    fun create(@RequestBody input: JsonNode) = noStore(service.create(SeriesRequests.create(input)))

    @PutMapping("/{id}/metadata")
    fun update(@PathVariable id: Long, @RequestBody input: JsonNode) =
        noStore(service.update(id, SeriesRequests.metadata(input)))

    @PutMapping("/{id}/order")
    fun order(@PathVariable id: Long, @RequestBody input: JsonNode): ResponseEntity<*> {
        if (!input.isObject || input.size() != 1 || !input.path("order").isIntegralNumber || !input.path("order").canConvertToLong())
            throw InvalidSeriesRequestException()
        return noStore(service.setOrder(id, input.get("order").longValue()))
    }

    private fun <T : Any> noStore(value: T): ResponseEntity<T> = ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value)
}
