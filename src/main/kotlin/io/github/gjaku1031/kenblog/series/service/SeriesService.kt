package io.github.gjaku1031.kenblog.series.service

import io.github.gjaku1031.kenblog.series.domain.*
import io.github.gjaku1031.kenblog.series.dto.*
import io.github.gjaku1031.kenblog.series.repository.SeriesRepository
import io.github.gjaku1031.kenblog.post.repository.PostQueries
import io.github.gjaku1031.kenblog.post.repository.PostRepository
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

/**
 * 시리즈 메타데이터 저장과 첫 공개 글 대문 계산
 */
@Service
class SeriesService(
    /**
     * 시리즈 저장소
     */
    private val series: SeriesRepository,

    /**
     * 게시글 메타데이터 조회기
     */
    private val queries: PostQueries,

    /**
     * 기술 뱃지 서비스
     */
    private val badges: StackBadgeService,

    /**
     * 초안과 관련 글을 포함한 삭제 제약 조회
     */
    private val posts: PostRepository
    ) {
    /**
     * 시리즈 목록 조회
     */
    @Transactional(readOnly = true)
    fun list(admin: Boolean): List<SeriesResponse> = series.findAll()
        .filter { admin || it.visibility == PostVisibility.PUBLIC }
        .sortedWith(compareBy<SeriesEntity> { it.sortOrder }.thenBy { it.id })
        .map { response(it, admin) }.filter { admin || it.cover != null }

    /**
     * 시리즈 상세와 문서 목록 조회
     */
    @Transactional(readOnly = true)
    fun detail(id: Long): SeriesDetailResponse {
        val entity = series.findById(id).orElseThrow { SeriesNotFoundException() }
        val response = response(entity, true)
        return SeriesDetailResponse(response, queries.seriesPosts(id, false).map {
            SeriesPostResponse(it.id, it.title, it.slug, it.seriesOrder, it.status == PostStatus.PUBLISHED && it.visibility == PostVisibility.PUBLIC)
        })
    }

    /**
     * 시리즈 생성
     *
     * 1. 종류별 접두사 선택, 주소 생략 시 UUID 기반 주소 생성
     * 2. 메타데이터 저장, 고유 제약 충돌을 업무 오류로 변환
     * 3. 프로젝트 기술 선택도 같은 트랜잭션에 저장
     */
    @Transactional
    fun create(input: SeriesCreateRequest): SeriesResponse {
        // 종류별 접두사 선택, 주소 생략 시 UUID 기반 주소 생성
        val prefix = if (input.kind == SeriesKind.PROJECT) "project" else "series"
        val slug = (input.slug ?: "$prefix-${UUID.randomUUID()}").trim().lowercase(Locale.ROOT)
        if (slug.length > 160 || !Regex("[a-z0-9]+(?:-[a-z0-9]+)*").matches(slug) || input.metadata.baseUpdatedAt != null)
            throw InvalidSeriesRequestException()
        val value = SeriesRequests.validate(input.kind, input.metadata)
        // 메타데이터 저장, 고유 제약 충돌을 업무 오류로 변환
        val entity = try { series.saveAndFlush(SeriesEntity(slug, input.kind, value.name, value.description,
            value.projectStatus, value.startPeriod, value.endPeriod, now())) }
        catch (_: DataIntegrityViolationException) { throw SeriesConflictException() }
        // 프로젝트 기술 선택도 같은 트랜잭션에 저장
        if (entity.kind == SeriesKind.PROJECT) badges.replaceSeriesStack(entity.id!!, value.stackBadgeNames)
        return response(entity, true)
    }

    /**
     * 기존 수정 시각을 확인하고 시리즈 속성 변경
     *
     * 1. 시리즈 잠금 후 기존 수정 시각을 비교해 덮어쓰기 방지
     * 2. 검증된 속성으로 갱신
     * 3. 프로젝트 기술 선택까지 함께 교체
     */
    @Transactional
    fun update(id: Long, input: SeriesMetadataRequest): SeriesResponse {
        // 시리즈 잠금 후 기존 수정 시각을 비교해 덮어쓰기 방지
        val entity = series.findLockedById(id) ?: throw SeriesNotFoundException()
        if (input.baseUpdatedAt == null || input.baseUpdatedAt != entity.updatedAt) throw SeriesConflictException()
        // 검증된 속성으로 갱신
        val value = SeriesRequests.validate(entity.kind, input)
        entity.replace(value.name, value.description, value.projectStatus, value.startPeriod, value.endPeriod, now())
        series.saveAndFlush(entity)
        // 프로젝트 기술 선택까지 함께 교체
        if (entity.kind == SeriesKind.PROJECT) badges.replaceSeriesStack(id, value.stackBadgeNames)
        return response(entity, true)
    }

    /**
     * 시리즈 표시 순서 저장
     */
    @Transactional
    fun setOrder(id: Long, order: Long): SeriesResponse {
        if (order !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) throw InvalidSeriesRequestException()
        val entity = series.findLockedById(id) ?: throw SeriesNotFoundException()
        entity.reorder(order); series.saveAndFlush(entity)
        return response(entity, true)
    }

    /**
     * 소속 글과 관련 글이 없는 시리즈만 삭제
     *
     * 1. 글 생성·연결 변경과 같은 부모 행 잠금 취득
     * 2. 초안·비공개를 포함한 모든 글 참조 확인, 하나라도 남으면 HTTP 409
     * 3. 시리즈 삭제, 기술 뱃지 연결은 기존 FK CASCADE로 함께 제거
     */
    @Transactional
    fun delete(id: Long) {
        // 부모 잠금으로 검사 이후 새 글 참조가 추가되는 경합 차단
        if (id <= 0) throw InvalidSeriesRequestException()
        val entity = series.findLockedById(id) ?: throw SeriesNotFoundException()
        // 소속과 관련 참조를 모두 검사한 뒤 삭제
        if (posts.existsBySeriesIdOrRelatedSeriesId(id, id)) throw SeriesInUseException()
        series.delete(entity)
        series.flush()
    }

    /**
     * 시리즈 속성·첫 공개 문서·기술 뱃지를 응답에 결합
     */
    private fun response(entity: SeriesEntity, admin: Boolean): SeriesResponse {
        val id = entity.id!!
        val publicPosts = queries.seriesPosts(id, true)
        return SeriesResponse(id, entity.slug, entity.name, entity.kind, entity.description, entity.visibility,
            entity.projectStatus, entity.startPeriod, entity.endPeriod, entity.sortOrder, entity.updatedAt,
            publicPosts.firstOrNull()?.let { PostSeriesItem(it.id, it.slug, it.title, 1) },
            if (admin) queries.seriesPosts(id, false).size else publicPosts.size,
            if (entity.kind == SeriesKind.PROJECT) badges.listForSeries(id) else emptyList())
    }

    /**
     * 마이크로초 정밀도의 현재 UTC 시각
     */
    private fun now() = LocalDateTime.now(ZoneOffset.UTC).truncatedTo(java.time.temporal.ChronoUnit.MICROS)
}
