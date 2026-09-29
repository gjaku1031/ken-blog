package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import java.time.LocalDate
import java.time.LocalDateTime

/** [ContentFeedItem] 변환을 위해 피드·검색 SQL이 본문 없이 선택한 글과 허용된 부모 표시 필드. */
data class ContentFeedRow(val id: Long, val title: String, val slug: String, val section: PostSection,
    val summary: String, val publishedAt: LocalDateTime, val visibility: PostVisibility,
    val categoryId: Long?, val projectSlug: String?, val courseSlug: String?,
    val projectName: String?, val courseName: String?, val courseField: String?, val courseId: Long?,
    val chapterOrder: Int?, val techSeriesOrder: Int?)

/** [ContentFeedRow]에서 소속 이름·주소와 권한별 탐색 번호를 결합한 Home·검색 카드. */
data class ContentFeedItem(val id: Long, val title: String, val slug: String, val section: PostSection,
    val summary: String, val publishedDate: LocalDate, val visibility: PostVisibility,
    val category: CategoryRefResponse?, val tags: List<String>, val projectSlug: String?,
    val courseSlug: String?, val projectName: String?, val courseName: String?, val courseField: String?,
    val chapterPosition: Int?, val chapterTotal: Int?,
    val seriesPosition: Int? = null, val seriesTotal: Int? = null,
    val techSeriesOrder: Int? = null)

/** 동일 권한·필터로 계산한 피드·검색의 페이지와 전체 건수. */
data class ContentFeedPage(val items: List<ContentFeedItem>, val page: Int, val size: Int,
    val totalElements: Long, val totalPages: Int)
