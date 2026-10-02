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
import org.springframework.data.repository.findByIdOrNull
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/** Pages용 공개 글 메타데이터와 시리즈·분류 내 문서 탐색. 본문은 Node 빌드 담당. */
@Service
class PublicPostService(private val queries: PostQueries, private val categories: CategoryRepository,
    private val taxonomy: PostTaxonomyMetadata, private val series: SeriesRepository) {
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
    private fun PostRow.publishedDate() = publishedAt!!.atZone(ZoneOffset.UTC).withZoneSameInstant(ZoneId.of("Asia/Seoul")).toLocalDate()
}
