package io.github.gjaku1031.kenblog.analytics.controller

import io.github.gjaku1031.kenblog.analytics.dto.AnalyticsResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam

/** GA4 상태와 실측 관리자 대시보드의 HTTP/OpenAPI 계약. */
interface AnalyticsApi {
    /** @return 선택 기간의 실측 결과 또는 미설정·빈 결과·오류 상태. */
    @GetMapping("/api/v1/admin/analytics")
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "GA4 대시보드")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400"), ApiResponse(responseCode = "401"), ApiResponse(responseCode = "403")])
    fun report(@RequestParam(defaultValue = "7") range: Int): AnalyticsResponse
}
