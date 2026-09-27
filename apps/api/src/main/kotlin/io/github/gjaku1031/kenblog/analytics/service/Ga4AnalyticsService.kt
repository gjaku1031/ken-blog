package io.github.gjaku1031.kenblog.analytics.service

import com.google.auth.oauth2.GoogleCredentials
import com.google.auth.oauth2.ServiceAccountCredentials
import io.github.gjaku1031.kenblog.analytics.dto.AnalyticsMetrics
import io.github.gjaku1031.kenblog.analytics.dto.AnalyticsResponse
import io.github.gjaku1031.kenblog.analytics.dto.AnalyticsStatus
import io.github.gjaku1031.kenblog.analytics.dto.DailyVisitors
import io.github.gjaku1031.kenblog.analytics.dto.ProjectAnalytics
import io.github.gjaku1031.kenblog.analytics.dto.TopPage
import io.github.gjaku1031.kenblog.analytics.dto.TrafficSource
import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import io.github.gjaku1031.kenblog.project.repository.ProjectRepository
import java.io.ByteArrayInputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.concurrent.CompletableFuture
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

/** Google Analytics Data API의 실제 보고서만 관리자 대시보드에 전달. */
@Service
class Ga4AnalyticsService(
    @Value("\${app.analytics.ga4.property-id:}") private val propertyId: String,
    @Value("\${app.analytics.ga4.service-account-json-base64:}") private val credentialsBase64: String,
    private val mapper: ObjectMapper,
    private val projects: ProjectRepository,
) {
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()

    /**
     * 7·30·90일 보고서를 읽고 미설정·빈 결과·연동 실패를 구분.
     *
     * 외부 API 오류의 본문과 자격 증명은 응답이나 로그에 포함하지 않음.
     */
    fun report(range: Int): AnalyticsResponse {
        if (range !in setOf(7, 30, 90)) throw OperationFailure(HttpStatus.BAD_REQUEST, "분석 기간을 확인하세요.")
        if (propertyId.isBlank() && credentialsBase64.isBlank()) return empty(AnalyticsStatus.UNCONFIGURED, range)
        if (!propertyId.matches(Regex("[0-9]+")) || credentialsBase64.isBlank()) return empty(AnalyticsStatus.ERROR, range)
        return try { load(range) } catch (_: Exception) { empty(AnalyticsStatus.ERROR, range) }
    }

    /** @return 모든 보고서가 성공한 경우에만 실제 측정치를 조합한 응답. */
    private fun load(range: Int): AnalyticsResponse {
        val raw = Base64.getDecoder().decode(credentialsBase64)
        val credentials = ByteArrayInputStream(raw).use { GoogleCredentials.fromStream(it) }
        if (credentials !is ServiceAccountCredentials) return empty(AnalyticsStatus.ERROR, range)
        val scoped = credentials.createScoped(listOf("https://www.googleapis.com/auth/analytics.readonly"))
        scoped.refreshIfExpired()
        val token = scoped.accessToken?.tokenValue ?: return empty(AnalyticsStatus.ERROR, range)
        val end = LocalDate.now(ZoneId.of("Asia/Seoul")).minusDays(1)
        val start = end.minusDays(range.toLong() - 1)
        val previousEnd = start.minusDays(1)
        val previousStart = previousEnd.minusDays(range.toLong() - 1)
        val reportsFuture = CompletableFuture.supplyAsync {
            batchReports(token, listOf(
                reportRequest(start, end, emptyList(), listOf("activeUsers", "screenPageViews", "averageSessionDuration", "sessions")),
                reportRequest(start, end, listOf("date"), listOf("activeUsers")),
                reportRequest(start, end, listOf("pagePathPlusQueryString", "pageTitle"), listOf("screenPageViews", "userEngagementDuration"), 10000),
                reportRequest(start, end, listOf("sessionSource", "sessionDefaultChannelGroup"), listOf("sessions"), 10000),
                reportRequest(start, end, listOf("landingPagePlusQueryString"), listOf("sessions"), 10000),
            ))
        }
        val previous = rows(runReport(token, previousStart, previousEnd, emptyList(), listOf("activeUsers", "screenPageViews"))).firstOrNull()
        val reports = reportsFuture.get()
        val summary = rows(reports[0]).firstOrNull()
            ?: return empty(AnalyticsStatus.EMPTY, range)
        val visitors = metric(summary, 0)
        val pageViews = metric(summary, 1)
        if (visitors == 0L && pageViews == 0L) return empty(AnalyticsStatus.EMPTY, range)
        val daily = rows(reports[1]).map { row ->
            val day = dimension(row, 0)
            DailyVisitors(LocalDate.parse(day, DateTimeFormatter.BASIC_ISO_DATE).toString(), metric(row, 0))
        }.sortedBy { it.date }
        val pageRows = rows(reports[2])
        val pages = pageRows.map { row ->
            val path = dimension(row, 0)
            TopPage(path, dimension(row, 1), section(path), metric(row, 0))
        }.sortedByDescending { it.views }
        val documentRows = pageRows.filter { DOCUMENT_PATH.containsMatchIn(dimension(it, 0)) }
        val documentViews = documentRows.sumOf { metric(it, 0) }
        val documentEngagement = documentRows.sumOf { decimal(it, 1) }
        val trafficRows = rows(reports[3])
        val traffic = trafficRows.groupBy { channel(dimension(it, 0), dimension(it, 1)) }
            .map { (channel, grouped) -> TrafficSource(channel, grouped.sumOf { metric(it, 0) }, 0.0) }
            .sortedByDescending { it.sessions }
        val totalTraffic = traffic.sumOf { it.sessions }
        val landingRows = rows(reports[4])
        val projectSessions = landingRows.filter { PROJECT_PATH.containsMatchIn(dimension(it, 0)) }.sumOf { metric(it, 0) }
        val totalSessions = metric(summary, 3)
        val projectHomes = pages.mapNotNull { page ->
            val match = PROJECT_HOME.matchEntire(page.path.substringBefore('?')) ?: return@mapNotNull null
            match.groupValues[1] to page.views
        }.groupBy({ it.first }, { it.second }).map { (slug, views) ->
            ProjectAnalytics(slug, projects.findBySlug(slug)?.name ?: slug, views.sum(), null)
        }.sortedByDescending { it.homeViews }.take(5)
        val funnelFutures = projectHomes.associate { project ->
            project.slug to CompletableFuture.supplyAsync { funnelRate(token, start, end, project.slug) }
        }
        val measuredProjects = projectHomes.map { it.copy(documentReachRate = funnelFutures.getValue(it.slug).get()) }
        return AnalyticsResponse(AnalyticsStatus.READY, range,
            AnalyticsMetrics(visitors, pageViews, if (documentViews > 0) documentEngagement / documentViews else null,
                if (totalSessions > 0) percentage(projectSessions, totalSessions) else null,
                previous?.let { change(visitors, metric(it, 0)) },
                previous?.let { change(pageViews, metric(it, 1)) }),
            daily, pages.take(5), traffic.map { it.copy(percentage = percentage(it.sessions, totalTraffic)) }, measuredProjects)
    }

    /** @return 한 GA4 property의 최대 다섯 보고서를 한 네트워크 요청으로 읽은 목록. */
    private fun batchReports(token: String, requests: List<Map<String, Any>>): List<JsonNode> {
        val body = mapper.writeValueAsString(mapOf("requests" to requests))
        val response = send(token, "v1beta", "batchRunReports", body)
        return response.get("reports")?.toList()?.also { if (it.size != requests.size) error("Incomplete GA4 batch") }
            ?: error("Empty GA4 batch")
    }

    /** @return 실제 대문 조회 사용자가 하위 문서에 이어 도달한 GA4 퍼널 비율. */
    private fun funnelRate(token: String, start: LocalDate, end: LocalDate, slug: String): Double? {
        val home = "/project/$slug"
        val document = "$home/docs/"
        val body = mapper.writeValueAsString(mapOf(
            "dateRanges" to listOf(mapOf("startDate" to start.toString(), "endDate" to end.toString())),
            "funnel" to mapOf("isOpenFunnel" to false, "steps" to listOf(
                mapOf("name" to "Project home", "filterExpression" to mapOf("funnelFieldFilter" to
                    mapOf("fieldName" to "pagePathPlusQueryString", "stringFilter" to mapOf("matchType" to "EXACT", "value" to home)))),
                mapOf("name" to "Project document", "filterExpression" to mapOf("funnelFieldFilter" to
                    mapOf("fieldName" to "pagePathPlusQueryString", "stringFilter" to mapOf("matchType" to "BEGINS_WITH", "value" to document)))),
            )),
        ))
        val table = send(token, "v1alpha", "runFunnelReport", body).get("funnelTable") ?: return null
        val headers = table.get("metricHeaders")?.toList() ?: return null
        val index = headers.indexOfFirst { it.get("name")?.textValue() == "funnelStepCompletionRate" }
        if (index < 0) return null
        val first = rows(table).firstOrNull { dimension(it, 0).startsWith("1.") } ?: return null
        return decimal(first, index) * 100
    }

    /** @return 서비스 계정 bearer 토큰으로 읽은 GA4 보고서 JSON. */
    private fun runReport(token: String, start: LocalDate, end: LocalDate, dimensions: List<String>, metrics: List<String>, limit: Int = 1000): JsonNode {
        val body = mapper.writeValueAsString(reportRequest(start, end, dimensions, metrics, limit))
        return send(token, "v1beta", "runReport", body)
    }

    /** @return GA 보고서 날짜·차원·지표 요청 본문. */
    private fun reportRequest(start: LocalDate, end: LocalDate, dimensions: List<String>, metrics: List<String>, limit: Int = 1000): Map<String, Any> = mapOf(
            "dateRanges" to listOf(mapOf("startDate" to start.toString(), "endDate" to end.toString())),
            "dimensions" to dimensions.map { mapOf("name" to it) },
            "metrics" to metrics.map { mapOf("name" to it) },
            "limit" to limit.toString(),
        )

    /** @return provider 본문을 노출하지 않고 성공 응답만 파싱한 GA JSON. */
    private fun send(token: String, version: String, method: String, body: String): JsonNode {
        val request = HttpRequest.newBuilder(URI("https://analyticsdata.googleapis.com/$version/properties/$propertyId:$method"))
            .timeout(Duration.ofSeconds(15))
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() !in 200..299) error("GA4 report unavailable")
        return mapper.readTree(response.body())
    }

    /** @return JSON 보고서의 행 배열 또는 빈 목록. */
    private fun rows(report: JsonNode): List<JsonNode> = report.get("rows")?.let { node -> node.toList() } ?: emptyList()

    /** @return 차원 셀 원문. */
    private fun dimension(row: JsonNode, index: Int): String = row.get("dimensionValues")?.get(index)?.get("value")?.textValue() ?: ""

    /** @return 정수 지표. */
    private fun metric(row: JsonNode, index: Int): Long =
        row.get("metricValues")?.get(index)?.get("value")?.textValue()?.toDoubleOrNull()?.toLong() ?: 0L

    /** @return 초 단위 소수 지표. */
    private fun decimal(row: JsonNode, index: Int): Double =
        row.get("metricValues")?.get(index)?.get("value")?.textValue()?.toDoubleOrNull() ?: 0.0

    /** @return 기간 대비 실측 변화율, 이전 값이 0이면 `null`. */
    private fun change(current: Long, previous: Long): Double? = if (previous > 0) (current - previous) * 100.0 / previous else null

    /** @return 분모가 있는 경우 실측 비율. */
    private fun percentage(part: Long, whole: Long): Double = if (whole > 0) part * 100.0 / whole else 0.0

    /** @return 경로에 따른 화면 섹션. */
    private fun section(path: String): String = when {
        path.contains("/project/") -> "PROJECTS"
        path.contains("/course/") -> "NOTES"
        path.contains("/post/") -> "TECH"
        else -> "OTHER"
    }

    /** @return GA source와 channel을 디자인의 유입 경로로 묶은 값. */
    private fun channel(source: String, group: String): String = when {
        source.contains("github", ignoreCase = true) -> "GITHUB"
        group.contains("Organic Search", ignoreCase = true) -> "SEARCH"
        group.contains("Social", ignoreCase = true) -> "SOCIAL"
        group.contains("Direct", ignoreCase = true) -> "DIRECT"
        else -> "OTHER"
    }

    /** @return 측정치를 비운 상태별 응답. */
    private fun empty(status: AnalyticsStatus, range: Int): AnalyticsResponse =
        AnalyticsResponse(status, range, null, emptyList(), emptyList(), emptyList(), emptyList())

    private companion object {
        val PROJECT_PATH = Regex("(?:^|/)project/[^/?#]+")
        val PROJECT_HOME = Regex("(?:/ken-blog)?/project/([^/?#]+)/?")
        val DOCUMENT_PATH = Regex("/(?:post/[^/?#]+|course/[^/?#]+/chapters/[^/?#]+|project/[^/?#]+/docs/[^/?#]+)")
    }
}
