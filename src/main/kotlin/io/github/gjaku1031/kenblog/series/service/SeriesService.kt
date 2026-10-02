package io.github.gjaku1031.kenblog.series.service

import io.github.gjaku1031.kenblog.series.domain.*
import io.github.gjaku1031.kenblog.series.dto.*
import io.github.gjaku1031.kenblog.series.repository.SeriesRepository
import io.github.gjaku1031.kenblog.post.repository.PostQueries
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.dto.PostSeriesItem
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.dao.DataIntegrityViolationException
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.Locale
import java.util.UUID

/** 시리즈 메타데이터 저장과 첫 공개 글 대문 계산. */
@Service
class SeriesService(private val series: SeriesRepository,
    private val queries: PostQueries, private val badges: StackBadgeService) {
    @Transactional(readOnly = true)
    fun list(admin: Boolean): List<SeriesResponse> = series.findAll()
        .filter { admin || it.visibility == PostVisibility.PUBLIC }
        .sortedWith(compareBy<SeriesEntity> { it.sortOrder }.thenBy { it.id })
        .map { response(it, admin) }.filter { admin || it.cover != null }

    @Transactional(readOnly = true)
    fun detail(id: Long): SeriesDetailResponse {
        val entity = series.findById(id).orElseThrow { SeriesNotFoundException() }
        val response = response(entity, true)
        return SeriesDetailResponse(response, queries.seriesPosts(id, false).map {
            SeriesPostResponse(it.id, it.title, it.slug, it.seriesOrder, it.status == PostStatus.PUBLISHED && it.visibility == PostVisibility.PUBLIC)
        })
    }
    @Transactional
    fun create(input: SeriesCreateRequest): SeriesResponse {
        val prefix = if (input.kind == SeriesKind.PROJECT) "project" else "series"
        val slug = (input.slug ?: "$prefix-${UUID.randomUUID()}").trim().lowercase(Locale.ROOT)
        if (slug.length > 160 || !Regex("[a-z0-9]+(?:-[a-z0-9]+)*").matches(slug) || input.metadata.baseUpdatedAt != null)
            throw InvalidSeriesRequestException()
        val value = SeriesRequests.validate(input.kind, input.metadata)
        val entity = try { series.saveAndFlush(SeriesEntity(slug, input.kind, value.name, value.description,
            value.projectStatus, value.startPeriod, value.endPeriod, now())) }
        catch (_: DataIntegrityViolationException) { throw SeriesConflictException() }
        if (entity.kind == SeriesKind.PROJECT) badges.replaceSeriesStack(entity.id!!, value.stackBadgeNames)
        return response(entity, true)
    }
    @Transactional
    fun update(id: Long, input: SeriesMetadataRequest): SeriesResponse {
        val entity = series.findLockedById(id) ?: throw SeriesNotFoundException()
        if (input.baseUpdatedAt == null || input.baseUpdatedAt != entity.updatedAt) throw SeriesConflictException()
        val value = SeriesRequests.validate(entity.kind, input)
        entity.replace(value.name, value.description, value.projectStatus, value.startPeriod, value.endPeriod, now())
        series.saveAndFlush(entity)
        if (entity.kind == SeriesKind.PROJECT) badges.replaceSeriesStack(id, value.stackBadgeNames)
        return response(entity, true)
    }
    @Transactional
    fun setOrder(id: Long, order: Long): SeriesResponse {
        if (order !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) throw InvalidSeriesRequestException()
        val entity = series.findLockedById(id) ?: throw SeriesNotFoundException()
        entity.reorder(order); series.saveAndFlush(entity)
        return response(entity, true)
    }
    private fun response(entity: SeriesEntity, admin: Boolean): SeriesResponse {
        val id = entity.id!!
        val publicPosts = queries.seriesPosts(id, true)
        return SeriesResponse(id, entity.slug, entity.name, entity.kind, entity.description, entity.visibility,
            entity.projectStatus, entity.startPeriod, entity.endPeriod, entity.sortOrder, entity.updatedAt,
            publicPosts.firstOrNull()?.let { PostSeriesItem(it.id, it.slug, it.title, 1) },
            if (admin) queries.seriesPosts(id, false).size else publicPosts.size,
            if (entity.kind == SeriesKind.PROJECT) badges.listForSeries(id) else emptyList())
    }
    private fun now() = LocalDateTime.now(ZoneOffset.UTC).truncatedTo(java.time.temporal.ChronoUnit.MICROS)
}
