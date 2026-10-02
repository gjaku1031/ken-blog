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

/**
 * 시리즈 메타데이터 저장과 첫 공개 글 대문 계산
 * 글과 파일은 시리즈 삭제로 지우지 않음
 */
@Service
class SeriesService(
    /**
     * 시리즈 저장소
     */
    private val series: SeriesRepository,
    /**
     * 게시글 저장소
     */
    private val posts: PostRepository,
    /**
     * 게시글 메타데이터 조회기
     */
    private val queries: PostQueries,
    /**
     * 기술 뱃지 서비스
     */
    private val badges: StackBadgeService
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
     * 1. 주소와 종류별 입력 검증
     * 2. 시리즈 저장, 고유 제약 충돌은 업무 오류로 변환
     * 3. 프로젝트이면 기술 선택도 같은 트랜잭션에 저장
     */
    @Transactional
    fun create(input: SeriesCreateRequest): SeriesResponse {
        // 주소와 종류별 입력 검증
        val slug = input.slug.trim().lowercase(Locale.ROOT)
        if (slug.length > 160 || !Regex("[a-z0-9]+(?:-[a-z0-9]+)*").matches(slug) || input.metadata.baseUpdatedAt != null)
            throw InvalidSeriesRequestException()
        val value = SeriesRequests.validate(input.kind, input.metadata)
        // 시리즈 저장, 고유 제약 충돌은 업무 오류로 변환
        val entity = try { series.saveAndFlush(SeriesEntity(slug, input.kind, value.name, value.description,
            value.projectStatus, value.startPeriod, value.endPeriod, now())) }
        catch (_: DataIntegrityViolationException) { throw SeriesConflictException() }
        // 프로젝트이면 기술 선택도 같은 트랜잭션에 저장
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
     * 문서가 없는 시리즈 삭제
     *
     * 1. 삭제할 시리즈 잠금
     * 2. 문서가 남아 있으면 삭제 거부
     * 3. 빈 시리즈만 삭제
     */
    @Transactional
    fun delete(id: Long) {
        // 삭제할 시리즈 잠금
        val entity = series.findLockedById(id) ?: throw SeriesNotFoundException()
        // 문서가 남아 있으면 삭제 거부
        if (posts.existsBySeriesId(id)) throw SeriesConflictException()
        // 빈 시리즈만 삭제
        series.delete(entity); series.flush()
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
