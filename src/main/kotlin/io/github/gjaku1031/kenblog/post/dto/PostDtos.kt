package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.series.domain.SeriesKind
import java.time.LocalDate
import java.time.LocalDateTime

/** 시리즈의 최소 이동 정보. 종류는 시리즈 소속으로 결정. */
data class SeriesRef(val id: Long, val slug: String, val name: String, val kind: SeriesKind)

/** 본문·본문 해시를 제외한 관리자 메타데이터와 선언 관계. */
data class PostDetailResponse(
    val id: Long, val title: String, val slug: String,
    val createdAt: LocalDateTime, val updatedAt: LocalDateTime,
    val status: PostStatus, val visibility: PostVisibility, val publishedAt: LocalDateTime?,
    val category: CategoryRefResponse?, val tags: List<String>,
    val attachmentIds: List<Long>, val wikiTargets: List<String>,
    val series: SeriesRef?, val seriesOrder: Int?, val relatedSeriesId: Long?,
    val summary: String = "",
) {
    val section: SeriesKind get() = series?.kind ?: SeriesKind.TECH
}

/** 본문 없는 관리자 목록. */
data class PostSummaryResponse(
    val id: Long, val title: String, val slug: String,
    val createdAt: LocalDateTime, val updatedAt: LocalDateTime,
    val status: PostStatus, val visibility: PostVisibility, val publishedAt: LocalDateTime?,
    val category: CategoryRefResponse?, val tags: List<String>,
    val series: SeriesRef?, val seriesOrder: Int?, val summary: String, val relatedSeriesId: Long?,
) {
    val section: SeriesKind get() = series?.kind ?: SeriesKind.TECH
}

/** 관리자 목록의 페이지 정보. */
data class PostPageResponse(val items: List<PostSummaryResponse>, val page: Int, val size: Int,
    val totalElements: Long, val totalPages: Int)

/** 첫 출간 글과 같은 공통 문서 이동 정보. order는 시리즈 내 1기반 표시 위치. */
data class PostSeriesItem(val id: Long, val slug: String, val title: String, val order: Int)
/** 단일 문서도 포함하는 시리즈 이름·목록·현재 위치. */
data class PostSeriesResponse(val id: Long, val slug: String, val name: String,
    val kind: SeriesKind, val items: List<PostSeriesItem>, val position: Int)

/** Pages 생성용 메타데이터. 본문은 Git checkout에서만 주입. */
data class PublicPostDetailResponse(
    val id: Long, val title: String, val slug: String, val summary: String,
    val publishedDate: LocalDate, val section: SeriesKind,
    val category: CategoryRefResponse?, val tags: List<String>,
    val series: PostSeriesResponse?, val relatedSeries: SeriesRef?,
    val legacyPath: String?, val publishedAt: LocalDateTime? = null,
)
