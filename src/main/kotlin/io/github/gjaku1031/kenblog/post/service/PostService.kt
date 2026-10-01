package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.attachment.service.AttachmentLinkService
import io.github.gjaku1031.kenblog.category.domain.CategoryNotFoundException
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.content.service.RepositoryMarkdown
import io.github.gjaku1031.kenblog.post.domain.DuplicatePostSlugException
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostBodyHash
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostTagEntity
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.TagNames
import io.github.gjaku1031.kenblog.post.domain.WikiLinkConflictException
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest
import io.github.gjaku1031.kenblog.post.dto.PostPageResponse
import io.github.gjaku1031.kenblog.post.dto.PostSummaryResponse
import io.github.gjaku1031.kenblog.post.dto.TagCountResponse
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import io.github.gjaku1031.kenblog.post.repository.PostTagRepository
import io.github.gjaku1031.kenblog.series.repository.SeriesRepository
import io.github.gjaku1031.kenblog.series.domain.*
import io.github.gjaku1031.kenblog.post.repository.PostQueries
import java.sql.SQLIntegrityConstraintViolationException
import java.time.Clock
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.Locale
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.PageRequest
import org.springframework.data.repository.findByIdOrNull
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 게시글의 DB 메타데이터와 저장소 Markdown 읽기만 담당한다. */
@Service
class PostService(
    private val repository: PostRepository,
    private val categories: CategoryRepository,
    private val tags: PostTagRepository,
    private val taxonomy: PostTaxonomyMetadata,
    private val attachmentLinks: AttachmentLinkService,
    private val wikiLinks: WikiLinkMetadata,
    private val series: SeriesRepository,
    private val queries: PostQueries,
    private val markdown: RepositoryMarkdown,
) {
    /** 본문 없이 등록한다. 출간은 별도 상태 변경이며 원고 파일은 Git에서 직접 만든다. */
    @Transactional
    fun createMetadata(request: PostMetadataCreateRequest): PostDetailResponse {
        val title = validTitle(request.title)
        val slug = validSlug(request.slug)
        val summary = validSummary(request.summary)
        val normalizedTags = TagNames.displayAll(request.tags)
        if (request.categoryId != null) validCategory(request.categoryId)
        if (request.order != null && (request.order <= 0 || request.seriesId == null && request.categoryId == null))
            throw InvalidPostRequestException()
        request.seriesId?.let { if (it <= 0 || series.findLockedById(it) == null) throw SeriesNotFoundException() }
        request.relatedSeriesId?.let {
            if (it <= 0 || series.findLockedById(it)?.kind != SeriesKind.PROJECT) throw InvalidPostRequestException()
        }
        val now = now()
        val post = PostEntity(title, slug, "", now)
        post.replaceMetadata(title, summary, now)
        post.changeCategory(request.categoryId, now)
        post.assignSeries(request.seriesId, request.order, request.relatedSeriesId, now)
        val saved = try { repository.saveAndFlush(post) }
        catch (ex: DataIntegrityViolationException) {
            if (ex.isDuplicateSlugConstraint()) throw DuplicatePostSlugException(slug, ex)
            throw ex
        }
        val id = saved.id ?: error("Persisted post has no ID")
        if (normalizedTags.isNotEmpty())
            tags.saveAllAndFlush(normalizedTags.mapIndexed { index, name -> PostTagEntity(id, index, name) })
        attachmentLinks.replacePost(id, request.attachmentIds)
        wikiLinks.replacePost(id, request.wikiTargets)
        return saved.adminDetail(includeBody = false)
    }

    /** 관리자가 출간 상태만 명시적으로 전환한다. 저장소 파일은 수정하지 않는다. */
    @Transactional
    fun setPublished(id: Long, published: Boolean): PostDetailResponse {
        val post = lockedPost(id)
        if (published) post.publish(PostVisibility.PUBLIC, now()) else post.unpublish(now())
        repository.saveAndFlush(post)
        return post.adminDetail(includeBody = false)
    }

    /** 본문 열 없이 초안·출간 메타데이터를 고정 정렬로 조회한다. */
    @Transactional(readOnly = true)
    fun listDrafts(page: Int, size: Int): PostPageResponse {
        if (page < 0 || size !in 1..100 || page.toLong() * size > Int.MAX_VALUE) throw InvalidPostRequestException()
        val result = queries.adminPage(page, size)
        val metadata = taxonomy.batch(result.items.map { it.id }, result.items.map { it.categoryId })
        val items = result.items.map { row ->
            val view = metadata.getValue(row.id)
            PostSummaryResponse(row.id, row.title, row.slug, row.createdAt, row.updatedAt,
                row.status, row.visibility, row.publishedAt, view.category, view.tags,
                row.series, row.seriesOrder, row.summary, row.relatedSeriesId)
        }
        return PostPageResponse(items, page, size, result.total, result.pages)
    }

    /** 파일이 없는 글은 원본 경로를 포함한 404로 알린다. */
    @Transactional(readOnly = true)
    fun adminDetail(id: Long): PostDetailResponse = lockedPostRead(id).adminDetail(includeBody = true)

    /** 파일이 아직 없는 새 글도 제목·상태 등 메타데이터를 조회할 수 있다. */
    @Transactional(readOnly = true)
    fun adminMetadata(id: Long): PostDetailResponse = lockedPostRead(id).adminDetail(includeBody = false)

    /** 웹에서 제목·요약·분류·태그만 교체한다. */
    @Transactional
    fun updateMetadata(id: Long, title: String, summary: String, categoryId: Long?,
        rawTags: List<String>): PostDetailResponse {
        val normalizedTitle = validTitle(title)
        val normalizedSummary = validSummary(summary)
        val normalizedTags = TagNames.displayAll(rawTags)
        if (categoryId != null) validCategory(categoryId)
        val post = lockedPost(id)
        if (post.title != normalizedTitle || post.summary != normalizedSummary)
            post.replaceMetadata(normalizedTitle, normalizedSummary, now())
        if (post.categoryId != categoryId) post.changeCategory(categoryId, now())
        repository.saveAndFlush(post)
        if (tags.findNamesByPostId(id) != normalizedTags) {
            tags.deleteByPostId(id)
            if (normalizedTags.isNotEmpty())
                tags.saveAllAndFlush(normalizedTags.mapIndexed { index, name -> PostTagEntity(id, index, name) })
        }
        return post.adminDetail(includeBody = false)
    }

    /** 부모 잠금 순서를 지키며 섹션별 번호만 저장하고 Markdown 원문은 유지. */
    @Transactional
    fun setOrder(id: Long, order: Int?): PostDetailResponse {
        if (id <= 0 || (order != null && order <= 0)) throw InvalidPostRequestException()
        val post = lockedPost(id)
        if (order != null && post.seriesId == null && post.categoryId == null) throw InvalidPostRequestException()
        post.reorder(order)
        repository.saveAndFlush(post)
        return post.adminDetail(includeBody = false)
    }

    /** 새 소속을 먼저 잠근 뒤 글 소속과 순서를 함께 바꾼다. */
    @Transactional
    fun setSeries(id: Long, seriesId: Long?, order: Int?, relatedId: Long?): PostDetailResponse {
        if (id <= 0 || order != null && order <= 0) throw InvalidPostRequestException()
        val parents = listOfNotNull(seriesId, relatedId).distinct().sorted().associateWith {
            if (it <= 0) throw InvalidPostRequestException()
            series.findLockedById(it) ?: throw SeriesNotFoundException()
        }
        if (relatedId != null && parents.getValue(relatedId).kind != SeriesKind.PROJECT) throw InvalidPostRequestException()
        val post = lockedPost(id)
        if (order != null && seriesId == null && post.categoryId == null) throw InvalidPostRequestException()
        post.assignSeries(seriesId, order, relatedId, now())
        repository.saveAndFlush(post)
        return post.adminDetail(false)
    }

    /** 본문 해시를 확인한 후 위키 대상 선언만 교체한다. */
    @Transactional
    fun replaceWikiLinks(id: Long, expectedBodySha256: String, wikiTargets: List<String>): PostDetailResponse {
        val post = lockedPost(id)
        if (PostBodyHash.sha256(markdown.readPost(post)) != expectedBodySha256) throw WikiLinkConflictException()
        wikiLinks.replacePost(id, wikiTargets)
        return post.adminDetail(includeBody = true)
    }

    /** Git 원고의 첨부 참조에 대해 공개 다운로드 권한을 선언한다. */
    @Transactional
    fun replaceAttachments(id: Long, attachmentIds: List<Long>): PostDetailResponse {
        val post = lockedPost(id)
        attachmentLinks.replacePost(id, attachmentIds)
        return post.adminDetail(includeBody = false)
    }

    @Transactional(readOnly = true)
    fun adminTags(): List<TagCountResponse> = queries.tagCounts(false)

    @Transactional(readOnly = true)
    fun findById(id: Long): PostEntity? = if (id > 0) repository.findByIdOrNull(id) else null

    @Transactional(readOnly = true)
    fun findBySlug(slug: String): PostEntity? {
        val normalized = slug.trim().lowercase(Locale.ROOT)
        return if (normalized.length <= 160 && SLUG_PATTERN.matches(normalized)) repository.findBySlug(normalized) else null
    }

    private fun lockedPostRead(id: Long): PostEntity {
        if (id <= 0) throw InvalidPostRequestException()
        return repository.findByIdOrNull(id) ?: throw PostNotFoundException()
    }

    private fun lockedPost(id: Long): PostEntity {
        if (id <= 0) throw InvalidPostRequestException()
        return repository.findLockedById(id) ?: throw PostNotFoundException()
    }

    private fun PostEntity.adminDetail(includeBody: Boolean): PostDetailResponse {
        val postId = id ?: error("Persisted post has no ID")
        val view = taxonomy.one(postId, categoryId)
        val ref = seriesId?.let(series::findByIdOrNull)?.let {
            io.github.gjaku1031.kenblog.post.dto.SeriesRef(it.id!!, it.slug, it.name, it.kind)
        }
        val fileBody = if (includeBody) markdown.readPost(this) else ""
        return PostDetailResponse(postId, title, slug, fileBody, createdAt, updatedAt,
            status, visibility, publishedAt, view.category, view.tags, attachmentLinks.postIds(postId),
            wikiLinks.postTitles(postId), ref, seriesOrder, relatedSeriesId, summary,
            if (includeBody) PostBodyHash.sha256(fileBody) else "")
    }

    private fun validTitle(value: String): String = value.trim().also {
        if (it.isBlank() || it.codePointCount(0, it.length) > 200) throw InvalidPostRequestException()
    }

    private fun validSlug(value: String): String = value.trim().lowercase(Locale.ROOT).also {
        if (it.length > 160 || !SLUG_PATTERN.matches(it)) throw InvalidPostRequestException()
    }

    private fun validSummary(value: String): String = value.trim().also {
        if (it.codePointCount(0, it.length) > 120) throw InvalidPostRequestException()
    }

    private fun validCategory(id: Long) {
        if (id <= 0) throw InvalidPostRequestException()
        categories.findSharedById(id) ?: throw CategoryNotFoundException()
    }

    private fun now(): LocalDateTime =
        LocalDateTime.ofInstant(Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)

    private fun DataIntegrityViolationException.isDuplicateSlugConstraint(): Boolean =
        generateSequence<Throwable>(this) { it.cause }.any { cause ->
            cause is SQLIntegrityConstraintViolationException && cause.errorCode == 1062 &&
                cause.message?.contains("uk_posts_slug") == true
        }

    private companion object { val SLUG_PATTERN = Regex("[a-z0-9]+(?:-[a-z0-9]+)*") }
}
