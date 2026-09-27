package io.github.gjaku1031.kenblog.analytics.dto

/** Data API 연결 결과와 실제 데이터 유무. */
enum class AnalyticsStatus { UNCONFIGURED, EMPTY, READY, ERROR }

/** 실제 방문·조회·체류·프로젝트 유입 지표. */
data class AnalyticsMetrics(
    val visitors: Long,
    val pageViews: Long,
    val averageEngagementSeconds: Double?,
    val projectsSessionRate: Double?,
    val visitorsChangePercent: Double?,
    val pageViewsChangePercent: Double?,
)

/** 하루 단위 GA 활성 사용자 수. */
data class DailyVisitors(val date: String, val visitors: Long)

/** 경로·제목별 실제 조회 수. */
data class TopPage(val path: String, val title: String, val section: String, val views: Long)

/** GA 획득 채널별 세션과 전체 비율. */
data class TrafficSource(val channel: String, val sessions: Long, val percentage: Double)

/** 실제 프로젝트 대문 조회와 측정 가능할 때의 문서 도달률. */
data class ProjectAnalytics(val slug: String, val name: String, val homeViews: Long, val documentReachRate: Double?)

/** 가짜 수치 없이 Data API 상태와 선택 기간의 측정 결과를 전달. */
data class AnalyticsResponse(
    val status: AnalyticsStatus,
    val range: Int,
    val metrics: AnalyticsMetrics?,
    val dailyVisitors: List<DailyVisitors>,
    val topPages: List<TopPage>,
    val trafficSources: List<TrafficSource>,
    val projects: List<ProjectAnalytics>,
)
