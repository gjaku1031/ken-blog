package io.github.gjaku1031.kenblog.analytics.controller

import io.github.gjaku1031.kenblog.analytics.dto.AnalyticsResponse
import io.github.gjaku1031.kenblog.analytics.service.Ga4AnalyticsService
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** 관리자 GA4 보고서를 [Ga4AnalyticsService]에 연결. */
@RestController
class AnalyticsController(private val service: Ga4AnalyticsService) : AnalyticsApi {
    /** @return 7·30·90일 실제 통계 또는 연결 상태. */
    @GetMapping("/api/v1/admin/analytics")
    override fun report(@RequestParam(defaultValue = "7") range: Int): AnalyticsResponse = service.report(range)
}
