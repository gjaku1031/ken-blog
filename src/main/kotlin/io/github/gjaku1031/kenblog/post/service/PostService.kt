package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.attachment.service.AttachmentLinkService
import io.github.gjaku1031.kenblog.category.domain.CategoryNotFoundException
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.post.domain.DuplicatePostSlugException
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostEditConflictException
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.domain.PostTagEntity
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.TagNames
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
import java.util.UUID
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.repository.findByIdOrNull
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.annotation.Isolation

/**
 * 게시글의 DB 메타데이터·출간 상태·첨부 및 위키 관계 관리
 */
@Service
class PostService(
    /**
     * 게시글 저장소
     */
    private val repository: PostRepository,

    /**
     * 분류 저장소
     */
    private val categories: CategoryRepository,

    /**
     * 게시글 태그 저장소
     */
    private val tags: PostTagRepository,

    /**
     * 분류·태그 조회기
     */
    private val taxonomy: PostTaxonomyMetadata,

    /**
     * 첨부 연결 서비스
     */
    private val attachmentLinks: AttachmentLinkService,

    /**
     * 위키 선언 관리 서비스
     */
    private val wikiLinks: WikiLinkMetadata,

    /**
     * 시리즈 저장소
     */
    private val series: SeriesRepository,

    /**
     * 게시글 메타데이터 조회기
     */
    private val queries: PostQueries,

    /**
     * 전체 메타데이터 응답의 바이트 상한 검사
     */
    private val mapper: tools.jackson.databind.ObjectMapper,

) {
    /**
     * 본문 없이 등록함
     * 출간은 별도 상태 변경이며 원고 파일은 Git에서 직접 만듦
     *
     * 1. 입력 정규화, 주소가 없으면 UUID 기반 주소 생성
     * 2. 글 메타데이터 저장 후 주소 중복 충돌 변환
     * 3. 태그·첨부·위키 선언까지 같은 트랜잭션에 저장
     */
    @Transactional
    fun createMetadata(request: PostMetadataCreateRequest): PostDetailResponse {
        // 입력 정규화, 주소가 없으면 UUID 기반 주소 생성
        val title = validTitle(request.title)
        val slug = validSlug(request.slug ?: "post-${UUID.randomUUID()}")
        val summary = validSummary(request.summary)
        val normalizedTags = TagNames.displayAll(request.tags)
        if (request.categoryId != null) validCategory(request.categoryId)
        if (request.order != null && (request.order <= 0 || request.seriesId == null && request.categoryId == null))
            throw InvalidPostRequestException()
        lockSeries(request.seriesId, request.relatedSeriesId)
        val now = now()
        val post = PostEntity(title, slug, "", now)
        post.replaceMetadata(title, summary, now)
        post.changeCategory(request.categoryId, now)
        post.assignSeries(request.seriesId, request.order, request.relatedSeriesId, now)
        // 글 메타데이터 저장 후 주소 중복 충돌 변환
        val saved = try { repository.saveAndFlush(post) }
        catch (ex: DataIntegrityViolationException) {
            if (ex.isDuplicateSlugConstraint()) throw DuplicatePostSlugException(ex)
            throw ex
        }
        // 태그·첨부·위키 선언까지 같은 트랜잭션에 저장
        val id = saved.id ?: error("Persisted post has no ID")
        if (normalizedTags.isNotEmpty())
            tags.saveAllAndFlush(normalizedTags.mapIndexed { index, name -> PostTagEntity(id, index, name) })
        attachmentLinks.replacePost(id, request.attachmentIds)
        wikiLinks.replacePost(id, request.wikiTargets)
        return saved.adminDetail()
    }

    /**
     * 관리자가 출간 상태만 명시적으로 전환함
     * 저장소 파일은 수정하지 않음
     */
    @Transactional
    fun setPublished(id: Long, published: Boolean): PostDetailResponse {
        val post = lockedPost(id)
        if (published) post.publish(PostVisibility.PUBLIC, now()) else post.unpublish(now())
        post.advanceEdit(now())
        repository.saveAndFlush(post)
        return post.adminDetail()
    }

    /**
     * 글 메타데이터 삭제, 태그·첨부 연결·위키 선언은 기존 FK CASCADE로 정리
     * Git 원고와 첨부 파일 자체는 삭제하지 않음
     */
    @Transactional
    fun delete(id: Long) {
        repository.delete(lockedPost(id))
        repository.flush()
    }

    /**
     * 본문 열 없이 초안·출간 메타데이터를 고정 정렬로 조회함
     *
     * 1. 페이지 범위·오프셋 상한 검사
     * 2. 본문 없이 페이지 조회 후 분류·태그 일괄 조회
     * 3. 조회 행과 부가 메타데이터를 같은 글 ID로 결합
     */
    @Transactional(readOnly = true)
    fun listDrafts(page: Int, size: Int): PostPageResponse {
        // 페이지 범위·오프셋 상한 검사
        if (page < 0 || size !in 1..100 || page.toLong() * size > Int.MAX_VALUE) throw InvalidPostRequestException()
        // 본문 없이 페이지 조회 후 분류·태그 일괄 조회
        val result = queries.adminPage(page, size)
        val metadata = taxonomy.batch(result.items.map { it.id }, result.items.map { it.categoryId })
        // 조회 행과 부가 메타데이터를 같은 글 ID로 결합
        val items = result.items.map { row ->
            val view = metadata.getValue(row.id)
            PostSummaryResponse(row.id, row.title, row.slug, row.createdAt, row.updatedAt,
                row.status, row.visibility, row.publishedAt, view.category, view.tags,
                row.series, row.seriesOrder, row.summary, row.relatedSeriesId, row.editVersion)
        }
        return PostPageResponse(items, page, size, result.total, result.pages)
    }

    /**
     * 파일이 아직 없는 새 글도 제목·상태 등 메타데이터를 조회할 수 있음
     */
    @Transactional(readOnly = true)
    fun adminMetadata(id: Long): PostDetailResponse {
        if (id <= 0) throw InvalidPostRequestException()
        val row = queries.adminById(id) ?: throw PostNotFoundException()
        val view = taxonomy.one(id, row.categoryId)
        return PostDetailResponse(id, row.title, row.slug, row.createdAt, row.updatedAt, row.status, row.visibility,
            row.publishedAt, view.category, view.tags, attachmentLinks.postIds(id), wikiLinks.postTitles(id),
            row.series, row.seriesOrder, row.relatedSeriesId, row.summary, row.editVersion)
    }

    /**
     * 페이지 사이의 변경으로 글이 누락되지 않는 관리자 전체 메타데이터 일관 읽기
     * 본문 제외, 최대 10,000건·8,000,000바이트
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun snapshot(): List<PostSummaryResponse> {
        val rows = queries.snapshotRows(false)
        val metadata = taxonomy.batch(rows.map { it.id }, rows.map { it.categoryId })
        val items = rows.map { row ->
            val view = metadata.getValue(row.id)
            PostSummaryResponse(row.id, row.title, row.slug, row.createdAt, row.updatedAt,
                row.status, row.visibility, row.publishedAt, view.category, view.tags,
                row.series, row.seriesOrder, row.summary, row.relatedSeriesId, row.editVersion)
        }
        check(mapper.writeValueAsBytes(items).size <= 8_000_000) { "Admin metadata snapshot too large" }
        return items
    }

    /**
     * 제목·요약·분류·태그·소속·순서를 기준 버전과 대조해 한 트랜잭션에서 교체
     * 분류 → ID 오름차순 시리즈 → 글 잠금 순서 유지, 충돌·검증 실패 시 전체 롤백
     */
    @Transactional
    fun updateMetadata(id: Long, request: PostMetadataCreateRequest, baseVersion: Long): PostDetailResponse {
        val title = validTitle(request.title)
        val summary = validSummary(request.summary)
        val normalizedTags = TagNames.displayAll(request.tags)
        if (request.categoryId != null) validCategory(request.categoryId)
        lockSeries(request.seriesId, request.relatedSeriesId)
        if (request.order != null && (request.order <= 0 || request.seriesId == null && request.categoryId == null))
            throw InvalidPostRequestException()
        // 같은 잠금 안에서 기준 버전을 검증하고 모든 편집 필드를 반영
        val post = lockedPost(id)
        requireVersion(post, baseVersion)
        val now = now()
        post.replaceMetadata(title, summary, now)
        post.changeCategory(request.categoryId, now)
        post.assignSeries(request.seriesId, request.order, request.relatedSeriesId, now)
        post.advanceEdit(now)
        repository.saveAndFlush(post)
        if (tags.findNamesByPostId(id) != normalizedTags) {
            tags.deleteByPostId(id)
            if (normalizedTags.isNotEmpty())
                tags.saveAllAndFlush(normalizedTags.mapIndexed { index, name -> PostTagEntity(id, index, name) })
        }
        return post.adminDetail()
    }

    /**
     * 글 잠금과 기준 버전 검사를 거쳐 문서 순서를 저장하고 Markdown 원문은 유지
     */
    @Transactional
    fun setOrder(id: Long, order: Int?, baseVersion: Long): PostDetailResponse {
        if (id <= 0 || (order != null && order <= 0)) throw InvalidPostRequestException()
        val post = lockedPost(id)
        requireVersion(post, baseVersion)
        if (order != null && post.seriesId == null && post.categoryId == null) throw InvalidPostRequestException()
        post.reorder(order)
        post.advanceEdit(now())
        repository.saveAndFlush(post)
        return post.adminDetail()
    }

    /**
     * 새 소속을 먼저 잠근 뒤 글 소속과 순서를 함께 바꿈
     *
     * 1. 글 ID·순서 입력 검사
     * 2. 소속·관련 시리즈를 ID 순서로 잠금
     * 3. 부모 잠금 뒤 글을 잠그고 새 소속·순서 저장
     */
    @Transactional
    fun setSeries(id: Long, seriesId: Long?, order: Int?, relatedId: Long?, baseVersion: Long): PostDetailResponse {
        // 글 ID·순서 입력 검사
        if (id <= 0 || order != null && order <= 0) throw InvalidPostRequestException()
        // 소속·관련 시리즈를 ID 순서로 잠금
        lockSeries(seriesId, relatedId)
        // 부모 잠금 뒤 글을 잠그고 새 소속·순서 저장
        val post = lockedPost(id)
        requireVersion(post, baseVersion)
        if (order != null && seriesId == null && post.categoryId == null) throw InvalidPostRequestException()
        post.assignSeries(seriesId, order, relatedId, now())
        post.advanceEdit(now())
        repository.saveAndFlush(post)
        return post.adminDetail()
    }

    /**
     * 원고 접근 없이 관리자 위키 대상 선언 전체를 교체
     * 마지막으로 저장한 선언 사용
     */
    @Transactional
    fun replaceWikiLinks(id: Long, wikiTargets: List<String>): PostDetailResponse {
        val post = lockedPost(id)
        wikiLinks.replacePost(id, wikiTargets)
        return post.adminDetail()
    }

    /**
     * Git 원고의 첨부 참조에 대해 공개 다운로드 권한을 선언함
     */
    @Transactional
    fun replaceAttachments(id: Long, attachmentIds: List<Long>): PostDetailResponse {
        val post = lockedPost(id)
        attachmentLinks.replacePost(id, attachmentIds)
        return post.adminDetail()
    }

    /**
     * 초안을 포함한 관리자 태그 사용량 조회
     */
    @Transactional(readOnly = true)
    fun adminTags(): List<TagCountResponse> = queries.tagCounts()

    /**
     * 양수 ID로 글 조회 및 쓰기 잠금 취득
     */
    private fun lockedPost(id: Long): PostEntity {
        if (id <= 0) throw InvalidPostRequestException()
        return repository.findLockedById(id) ?: throw PostNotFoundException()
    }

    /**
     * 글의 현재 분류·태그·첨부·위키·시리즈 정보를 응답에 결합
     *
     * 1. 저장 ID와 현재 분류·태그 조회
     * 2. 선택 시리즈 참조 구성
     * 3. 첨부·위키 선언을 포함한 관리자 응답 조립
     */
    private fun PostEntity.adminDetail(): PostDetailResponse {
        // 저장 ID와 현재 분류·태그 조회
        val postId = id ?: error("Persisted post has no ID")
        val view = taxonomy.one(postId, categoryId)
        // 선택 시리즈 참조 구성
        val ref = seriesId?.let(series::findByIdOrNull)?.let {
            io.github.gjaku1031.kenblog.post.dto.SeriesRef(it.id!!, it.slug, it.name, it.kind)
        }
        // 첨부·위키 선언을 포함한 관리자 응답 조립
        return PostDetailResponse(postId, title, slug, createdAt, updatedAt,
            status, visibility, publishedAt, view.category, view.tags, attachmentLinks.postIds(postId),
            wikiLinks.postTitles(postId), ref, seriesOrder, relatedSeriesId, summary, editVersion)
    }

    /**
     * 생성·소속 교체에서 공유하는 ID 오름차순 시리즈 잠금과 관련 프로젝트 검증
     */
    private fun lockSeries(seriesId: Long?, relatedId: Long?) {
        val parents = listOfNotNull(seriesId, relatedId).distinct().sorted().associateWith {
            if (it <= 0) throw InvalidPostRequestException()
            series.findLockedById(it) ?: throw SeriesNotFoundException()
        }
        if (relatedId != null && parents.getValue(relatedId).kind != SeriesKind.PROJECT) throw InvalidPostRequestException()
    }

    /**
     * 글 쓰기 잠금 안에서 오래된 편집 기준 거부
     */
    private fun requireVersion(post: PostEntity, version: Long) {
        if (version < 0) throw InvalidPostRequestException()
        if (post.editVersion != version) throw PostEditConflictException()
    }

    /**
     * 제목 공백 제거 후 빈 값·200 코드 포인트 초과 검사
     */
    private fun validTitle(value: String): String = value.trim().also {
        if (it.isBlank() || it.codePointCount(0, it.length) > 200) throw InvalidPostRequestException()
    }

    /**
     * 주소 공백 제거·소문자화 후 길이·패턴 검사
     */
    private fun validSlug(value: String): String = value.trim().lowercase(Locale.ROOT).also {
        if (it.length > 160 || !SLUG_PATTERN.matches(it)) throw InvalidPostRequestException()
    }

    /**
     * 요약 공백 제거 후 120 코드 포인트 상한 검사
     */
    private fun validSummary(value: String): String = value.trim().also {
        if (it.codePointCount(0, it.length) > 120) throw InvalidPostRequestException()
    }

    /**
     * 양수 분류 ID 검사 후 공유 잠금으로 존재 확인
     */
    private fun validCategory(id: Long) {
        if (id <= 0) throw InvalidPostRequestException()
        categories.findSharedById(id) ?: throw CategoryNotFoundException()
    }

    /**
     * 마이크로초 정밀도의 현재 UTC 시각
     */
    private fun now(): LocalDateTime =
        LocalDateTime.ofInstant(Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)

    /**
     * 예외 원인에서 게시글 주소 고유 제약 충돌 확인
     */
    private fun DataIntegrityViolationException.isDuplicateSlugConstraint(): Boolean =
        generateSequence<Throwable>(this) { it.cause }.any { cause ->
            cause is SQLIntegrityConstraintViolationException && cause.errorCode == 1062 &&
                cause.message?.contains("uk_posts_slug") == true
        }

    /**
     * 공통 상수·도우미
     */
    private companion object {
        /**
         * 주소 식별자 패턴
         */
        val SLUG_PATTERN = Regex("[a-z0-9]+(?:-[a-z0-9]+)*") }
}
