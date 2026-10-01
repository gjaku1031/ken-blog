package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.post.domain.*
import io.github.gjaku1031.kenblog.post.dto.*
import io.github.gjaku1031.kenblog.post.repository.PostQueries
import io.github.gjaku1031.kenblog.post.repository.PostRow
import io.github.gjaku1031.kenblog.series.domain.SeriesKind
import io.github.gjaku1031.kenblog.series.repository.SeriesRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.security.core.Authentication
import org.springframework.data.repository.findByIdOrNull
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/** 공통 공개 글 목록과 시리즈 우선 문서 탐색. 본문은 Git에서 주입. */
@Service
class PublicPostService(private val queries: PostQueries, private val categories: CategoryRepository,
    private val taxonomy: PostTaxonomyMetadata, private val series: SeriesRepository) {
    @Transactional(readOnly = true)
    fun list(page: Int, size: Int, authentication: Authentication?, categoryId: Long?, tag: String?,
        kind: SeriesKind? = SeriesKind.TECH): PublicPostPageResponse {
        validatePage(page, size)
        if (categoryId != null && categoryId <= 0) throw InvalidPostRequestException()
        val category = categoryId?.let { categories.findByIdOrNull(it)
            ?: return PublicPostPageResponse(emptyList(), page, size, 0, 0) }
        val result = queries.publicPage(page, size, kind, category?.path, tag?.takeIf { it.isNotBlank() }?.let(TagNames::normalize))
        return PublicPostPageResponse(summaries(result.items), page, size, result.total, result.pages)
    }
    fun summaries(rows: List<PostRow>): List<PublicPostSummaryResponse> {
        val views = taxonomy.batch(rows.map { it.id }, rows.map { it.categoryId })
        return rows.map { row -> val view = views.getValue(row.id)
            PublicPostSummaryResponse(row.id, row.title, row.slug, row.summary, row.publishedDate(),
                row.series?.kind ?: SeriesKind.TECH, view.category, view.tags, row.series, row.seriesOrder)
        }
    }
    @Transactional(readOnly = true)
    fun detailMetadata(slug: String): PublicPostDetailResponse {
        val row = queries.publicBySlug(slug.trim().lowercase(Locale.ROOT)) ?: throw PostNotFoundException()
        val view = taxonomy.one(row.id, row.categoryId)
        val navigation = row.series?.let { ref ->
            val siblings = queries.seriesPosts(ref.id, true)
            PostSeriesResponse(ref.id, ref.slug, ref.name, ref.kind, siblings.mapIndexed { i, p ->
                PostSeriesItem(p.id, p.slug, p.title, i + 1) }, siblings.indexOfFirst { it.id == row.id } + 1)
        } ?: row.categoryId?.let { id -> categories.findByIdOrNull(id)?.takeIf { it.depth == 3 }?.let { category ->
            val siblings = queries.categoryPosts(id)
            PostSeriesResponse(id, category.path, category.name, SeriesKind.TECH, siblings.mapIndexed { i, p ->
                PostSeriesItem(p.id, p.slug, p.title, i + 1) }, siblings.indexOfFirst { it.id == row.id } + 1)
        } }
        val related = row.relatedSeriesId?.let { id -> series.findByIdOrNull(id)?.takeIf {
            it.kind == SeriesKind.PROJECT && it.visibility == PostVisibility.PUBLIC && queries.seriesPosts(id, true).isNotEmpty()
        }?.let { SeriesRef(it.id!!, it.slug, it.name, it.kind) } }
        return PublicPostDetailResponse(row.id, row.title, row.slug, row.summary, row.publishedDate(),
            row.series?.kind ?: SeriesKind.TECH, view.category, view.tags, navigation, related, row.legacyPath, publishedAt = row.publishedAt)
    }
    fun validatePage(page: Int, size: Int) {
        if (page < 0 || size !in 1..100 || page.toLong() * size > Int.MAX_VALUE) throw InvalidPostRequestException()
    }
    private fun PostRow.publishedDate() = publishedAt!!.atZone(ZoneOffset.UTC).withZoneSameInstant(ZoneId.of("Asia/Seoul")).toLocalDate()
}
