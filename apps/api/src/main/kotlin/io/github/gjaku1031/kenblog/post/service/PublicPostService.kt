package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.TagNames
import io.github.gjaku1031.kenblog.post.dto.PrivatePostLockRow
import io.github.gjaku1031.kenblog.post.dto.PublicPostCacheRow
import io.github.gjaku1031.kenblog.post.dto.PublicPostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PublicPostPageResponse
import io.github.gjaku1031.kenblog.post.dto.PublicPostSummaryResponse
import io.github.gjaku1031.kenblog.post.dto.PublishedPostRow
import io.github.gjaku1031.kenblog.post.dto.TagCountResponse
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import io.github.gjaku1031.kenblog.post.repository.PostTagRepository
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale
import org.springframework.data.domain.PageRequest
import org.springframework.data.repository.findByIdOrNull
import org.springframework.security.core.Authentication
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 출간된 글의 권한별 DB 필터·최소 잠금 응답과 KST 최초 출간일 변환을 담당.
 *
 * [Authentication.isAuthenticated]는 익명 토큰에도 참일 수 있어 명시적 역할만 신뢰함.
 * 활성 캐시는 익명 PUBLIC 상세에 한정하고 현재 DB 공개 메타데이터를 먼저 확인함.
 */
@Service
class PublicPostService(
    private val repository: PostRepository,
    private val cache: PostBodyCache,
    private val categories: CategoryRepository,
    private val taxonomy: PostTaxonomyMetadata,
    private val tags: PostTagRepository,
) {
    /**
     * SELECT와 COUNT 양쪽에서 출간·가시성 조건을 적용한 본문 없는 목록을 조회.
     *
     * @param page 0 기반 페이지
     * @param size 1~100 페이지 크기
     * @param authentication ROLE_USER·ROLE_ADMIN 여부를 검사할 현재 인증
     * @param categoryId 선택한 분류와 자손을 모두 포함할 양수 ID
     * @param tag 정규화 후 정확히 일치시킬 선택 태그
     * @return 현재 권한의 목록·건수와 KST [LocalDate]의 [PublicPostPageResponse]
     * @throws InvalidPostRequestException 페이지·오프셋 범위를 벗어날 때
     */
    @Transactional(readOnly = true)
    fun list(page: Int, size: Int, authentication: Authentication?, categoryId: Long?, tag: String?): PublicPostPageResponse {
        if (page < 0 || size !in 1..MAX_PAGE_SIZE || page.toLong() * size > Int.MAX_VALUE) {
            throw InvalidPostRequestException()
        }
        if (categoryId != null && categoryId <= 0) throw InvalidPostRequestException()
        val normalizedTag = tag?.let(TagNames::normalize)
        val categoryPath = categoryId?.let { categories.findByIdOrNull(it)?.path
            ?: return PublicPostPageResponse(emptyList(), page, size, 0, 0) }
        val result = repository.findPublishedSummaries(
            PostStatus.PUBLISHED, PostVisibility.PUBLIC, authentication.canReadPrivate(),
            categoryPath, categoryPath?.let { "$it/%" }, normalizedTag, PageRequest.of(page, size),
        )
        val metadata = taxonomy.batch(result.content.map { it.id }, result.content.map { it.categoryId })
        return PublicPostPageResponse(result.content.map { it.summary(metadata.getValue(it.id)) }, page, size,
            result.totalElements, result.totalPages)
    }

    /**
     * 출간 slug를 조회하고 익명 PRIVATE이면 본문 열 없는 잠금 DTO만 반환.
     * 캐시 활성 익명 PUBLIC은 먼저 본문 없는 DB 메타데이터로 현재 권한·해시를 확인함.
     *
     * @param slug 정규화할 게시글 주소
     * @param authentication 명시적 USER·ADMIN 역할 검사 대상
     * @return 허용된 원문 또는 [PublicPostDetailResponse.locked]가 참인 잠금 상세
     * @throws PostNotFoundException 없는 slug·초안·잘못된 주소일 때
     */
    @Transactional(readOnly = true)
    fun detail(slug: String, authentication: Authentication?): PublicPostDetailResponse {
        val normalized = slug.trim().lowercase(Locale.ROOT)
        if (normalized.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.matches(normalized)) throw PostNotFoundException()
        if (authentication.canReadPrivate()) {
            val post = repository.findBySlugAndStatus(normalized, PostStatus.PUBLISHED) ?: throw PostNotFoundException()
            return post.publicDetail()
        }
        if (cache.enabled) {
            val metadata = repository.findPublicCacheMetadataBySlug(normalized, PostStatus.PUBLISHED, PostVisibility.PUBLIC)
            if (metadata != null) {
                cache.read(metadata.id, metadata.bodySha256)?.let { return metadata.publicDetail(it, taxonomy.one(metadata.id, metadata.categoryId)) }
                val post = repository.findBySlugAndStatusAndVisibility(normalized, PostStatus.PUBLISHED, PostVisibility.PUBLIC)
                    ?: throw PostNotFoundException()
                if (post.id == metadata.id && post.bodySha256 == metadata.bodySha256) {
                    cache.write(metadata.id, metadata.bodySha256, post.body)
                    return metadata.publicDetail(post.body, taxonomy.one(metadata.id, metadata.categoryId))
                }
                return post.publicDetail()
            }
            return repository.findPrivateLockBySlug(normalized, PostStatus.PUBLISHED, PostVisibility.PRIVATE)
                ?.lockedDetail() ?: throw PostNotFoundException()
        }
        repository.findBySlugAndStatusAndVisibility(normalized, PostStatus.PUBLISHED, PostVisibility.PUBLIC)
            ?.let { return it.publicDetail() }
        return repository.findPrivateLockBySlug(normalized, PostStatus.PUBLISHED, PostVisibility.PRIVATE)
            ?.lockedDetail() ?: throw PostNotFoundException()
    }

    /**
     * 읽기 권한이 있는 출간 글의 태그 사용 글 수만 SQL에서 집계.
     *
     * @param authentication ROLE_USER·ROLE_ADMIN 여부를 검사할 현재 인증
     * @return 사용량 내림차순·이름 오름차순의 [TagCountResponse] 목록
     */
    @Transactional(readOnly = true)
    fun tags(authentication: Authentication?): List<TagCountResponse> =
        tags.findPublicCounts(PostStatus.PUBLISHED, PostVisibility.PUBLIC, authentication.canReadPrivate())

    /** @return 명시적인 읽기 권한 역할만 허용하며 익명 인증 토큰은 거부. */
    private fun Authentication?.canReadPrivate(): Boolean = this?.authorities?.any {
        it.authority == "ROLE_USER" || it.authority == "ROLE_ADMIN"
    } == true

    /** @return 원문을 포함한 공개 상세; 최초 출간일은 KST 날짜로 변환. */
    private fun PostEntity.publicDetail(): PublicPostDetailResponse {
        val postId = id ?: error("Published post has no ID")
        val view = taxonomy.one(postId, categoryId)
        return PublicPostDetailResponse(postId, title, slug, publishedAt.kstDate(), locked = false, body = body,
            category = view.category, tags = view.tags)
    }

    /** @return 현재 DB 제목·출간일과 유효한 캐시 또는 DB 본문을 결합한 PUBLIC 상세. */
    private fun PublicPostCacheRow.publicDetail(body: String, view: PostTaxonomyView): PublicPostDetailResponse =
        PublicPostDetailResponse(id, title, slug, publishedAt.kstDate(), locked = false, body = body,
            category = view.category, tags = view.tags)

    /** @return 본문을 읽지 않은 익명 PRIVATE 잠금 상세. */
    private fun PrivatePostLockRow.lockedDetail(): PublicPostDetailResponse =
        PublicPostDetailResponse(id, title, slug, publishedAt.kstDate(), locked = true, body = null,
            category = null, tags = emptyList())

    /** @return 본문 없는 출간 목록 항목. */
    private fun PublishedPostRow.summary(view: PostTaxonomyView): PublicPostSummaryResponse =
        PublicPostSummaryResponse(id, title, slug, publishedAt.kstDate(), view.category, view.tags)

    /** @return DB의 최초 UTC 시각을 Asia/Seoul 화면용 날짜로 변환. */
    private fun LocalDateTime?.kstDate(): LocalDate =
        (this ?: error("Published post has no publication time"))
            .atZone(ZoneOffset.UTC).withZoneSameInstant(SEOUL).toLocalDate()

    private companion object {
        const val MAX_PAGE_SIZE = 100
        const val MAX_SLUG_LENGTH = 160
        val SLUG_PATTERN = Regex("[a-z0-9]+(?:-[a-z0-9]+)*")
        val SEOUL: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
