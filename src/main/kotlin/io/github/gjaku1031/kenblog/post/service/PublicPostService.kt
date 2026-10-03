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

/**
 * Pages용 공개 글 메타데이터와 시리즈·분류 내 문서 탐색
 * 본문은 Node 빌드 담당
 */
@Service
class PublicPostService(
    /**
     * 게시글 메타데이터 조회기
     */
    private val queries: PostQueries,

    /**
     * 분류 저장소
     */
    private val categories: CategoryRepository,

    /**
     * 분류·태그 조회기
     */
    private val taxonomy: PostTaxonomyMetadata,

    /**
     * 시리즈 저장소
     */
    private val series: SeriesRepository
    ) {
    /**
     * 공개 글 메타데이터와 시리즈·분류 탐색 정보 조립
     *
     * 1. 공개 글과 분류·태그 조회
     * 2. 시리즈 탐색 우선, 없으면 소분류의 공개 글로 탐색 구성
     * 3. 출간 문서가 있는 공개 관련 프로젝트만 노출
     */
    @Transactional(readOnly = true)
    fun detailMetadata(slug: String): PublicPostDetailResponse {
        // 공개 글과 분류·태그 조회
        val row = queries.publicBySlug(slug.trim().lowercase(Locale.ROOT)) ?: throw PostNotFoundException()
        val view = taxonomy.one(row.id, row.categoryId)
        // 시리즈 탐색 우선, 없으면 소분류의 공개 글로 탐색 구성
        val navigation = row.series?.let { ref ->
            val siblings = queries.seriesPosts(ref.id, true)
            PostSeriesResponse(ref.id, ref.slug, ref.name, ref.kind, siblings.mapIndexed { i, p ->
                PostSeriesItem(p.id, p.slug, p.title, i + 1) }, siblings.indexOfFirst { it.id == row.id } + 1)
        } ?: row.categoryId?.let { id -> categories.findByIdOrNull(id)?.takeIf { it.depth == 2 }?.let { category ->
            val siblings = queries.categoryPosts(id)
            PostSeriesResponse(id, category.path, category.name, SeriesKind.TECH, siblings.mapIndexed { i, p ->
                PostSeriesItem(p.id, p.slug, p.title, i + 1) }, siblings.indexOfFirst { it.id == row.id } + 1)
        } }
        // 출간 문서가 있는 공개 관련 프로젝트만 노출
        val related = row.relatedSeriesId?.let { id -> series.findByIdOrNull(id)?.takeIf {
            it.kind == SeriesKind.PROJECT && it.visibility == PostVisibility.PUBLIC && queries.seriesPosts(id, true).isNotEmpty()
        }?.let { SeriesRef(it.id!!, it.slug, it.name, it.kind) } }
        return PublicPostDetailResponse(row.id, row.title, row.slug, row.summary, row.publishedDate(),
            row.series?.kind ?: SeriesKind.TECH, view.category, view.tags, navigation, related, row.legacyPath, publishedAt = row.publishedAt)
    }

    /**
     * 같은 읽기 트랜잭션의 전체 공개 행에서 분류·태그와 문서 탐색을 일괄 구성
     * 시리즈 없는 글의 소분류 탐색에는 같은 분류의 TECH 시리즈 글도 포함
     */
    fun batch(rows: List<PostRow>): List<PublicPostDetailResponse> {
        val metadata = taxonomy.batch(rows.map { it.id }, rows.map { it.categoryId })
        val ordered = rows.sortedWith(compareBy<PostRow, Int?>(nullsLast()) { it.seriesOrder }
            .thenBy(nullsLast()) { it.publishedAt }.thenBy { it.id })
        val seriesGroups = ordered.filter { it.series != null }.groupBy { it.series!!.id }
        val categoryGroups = ordered.filter { it.series == null || it.series.kind == SeriesKind.TECH }.groupBy { it.categoryId }
        val seriesItems = seriesGroups.mapValues { (_, siblings) -> siblings.mapIndexed { index, row -> PostSeriesItem(row.id, row.slug, row.title, index + 1) } }
        val categoryItems = categoryGroups.mapValues { (_, siblings) -> siblings.mapIndexed { index, row -> PostSeriesItem(row.id, row.slug, row.title, index + 1) } }
        val positions = seriesItems.values.flatMap { it }.associate { it.id to it.order }
        val categoryPositions = categoryItems.values.flatMap { it }.associate { it.id to it.order }
        return rows.map { row ->
            val view = metadata.getValue(row.id)
            val category = view.category
            val navigation = row.series?.let { ref ->
                PostSeriesResponse(ref.id, ref.slug, ref.name, ref.kind, seriesItems.getValue(ref.id), positions.getValue(row.id))
            } ?: category?.takeIf { it.depth == 2 }?.let {
                PostSeriesResponse(it.id, it.path, it.name, SeriesKind.TECH, categoryItems.getValue(it.id), categoryPositions.getValue(row.id))
            }
            val related = row.relatedSeriesId?.let { seriesGroups[it]?.firstOrNull()?.series }?.takeIf { it.kind == SeriesKind.PROJECT }
            PublicPostDetailResponse(row.id, row.title, row.slug, row.summary, row.publishedDate(),
                row.series?.kind ?: SeriesKind.TECH, category, view.tags, navigation, related, row.legacyPath, row.publishedAt)
        }
    }

    /**
     * UTC 출간 시각을 한국 날짜로 변환
     */
    private fun PostRow.publishedDate() = publishedAt!!.atZone(ZoneOffset.UTC).withZoneSameInstant(ZoneId.of("Asia/Seoul")).toLocalDate()
}
