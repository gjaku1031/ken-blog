package io.github.gjaku1031.kenblog.post.repository

import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.PrivatePostLockRow
import io.github.gjaku1031.kenblog.post.dto.PublicPostCacheRow
import io.github.gjaku1031.kenblog.post.dto.PostSummaryResponse
import io.github.gjaku1031.kenblog.post.dto.PublishedPostRow
import io.github.gjaku1031.kenblog.post.service.PostService
import jakarta.persistence.LockModeType
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/**
 * [PostEntity]의 기본 저장·ID 조회를 [JpaRepository]에 맡기는 게시글 저장소.
 *
 * [PostService.createDraft]는 새 엔티티의 null ID를 유지한 채
 * [JpaRepository.saveAndFlush]를 호출하여 제약 오류를 트랜잭션 안에서 확인함.
 * ID 조회는 [JpaRepository.findById]를 사용함.
 */
interface PostRepository : JpaRepository<PostEntity, Long> {
    /**
     * 저장된 slug와 정확히 일치하는 게시글을 파생 쿼리로 조회.
     *
     * @param slug 정규화된 소문자 ASCII slug
     * @return 일치하는 [PostEntity], 없으면 `null`
     */
    fun findBySlug(slug: String): PostEntity?

    /**
     * 관리자 내용 PUT·삭제와 출간 상태 전환을 같은 행 잠금으로 직렬화.
     *
     * @param id 게시글 식별자
     * @return 잠근 [PostEntity], 없으면 `null`
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PostEntity p where p.id = :id")
    fun findLockedById(@Param("id") id: Long): PostEntity?

    /**
     * 본문 열을 읽지 않고 관리자 초안·출간 목록의 한 페이지를 생성자 DTO로 조회.
     *
     * @param pageable 검증된 0 기반 페이지와 크기; 정렬은 쿼리에 고정됨
     * @return 생성 시각·ID 내림차순의 [PostSummaryResponse] 페이지
     */
    @Query(
        value = "select new io.github.gjaku1031.kenblog.post.dto.PostSummaryResponse(p.id, p.title, p.slug, p.createdAt, p.updatedAt, p.status, p.visibility, p.publishedAt) " +
            "from PostEntity p order by p.createdAt desc, p.id desc",
        countQuery = "select count(p) from PostEntity p",
    )
    fun findAdminSummaries(pageable: Pageable): Page<PostSummaryResponse>

    /**
     * 본문 열 없이 출간 글을 권한별로 필터하고 같은 조건으로 전체 건수를 조회.
     *
     * @param published 출간 상태
     * @param publicVisibility 익명에게 노출할 범위
     * @param includePrivate USER 또는 ADMIN 권한이 있는지 여부
     * @param pageable 검증된 페이지와 크기
     * @return 최초 출간 시각·ID 내림차순의 [PublishedPostRow] 페이지
     */
    @Query(
        value = "select new io.github.gjaku1031.kenblog.post.dto.PublishedPostRow(p.id, p.title, p.slug, p.publishedAt) " +
            "from PostEntity p where p.status = :published and (:includePrivate = true or p.visibility = :publicVisibility) " +
            "order by p.publishedAt desc, p.id desc",
        countQuery = "select count(p) from PostEntity p where p.status = :published " +
            "and (:includePrivate = true or p.visibility = :publicVisibility)",
    )
    fun findPublishedSummaries(
        @Param("published") published: PostStatus,
        @Param("publicVisibility") publicVisibility: PostVisibility,
        @Param("includePrivate") includePrivate: Boolean,
        pageable: Pageable,
    ): Page<PublishedPostRow>

    /**
     * 권한 있는 열람자의 출간 글을 slug로 조회.
     *
     * @param slug 정규화된 주소
     * @param status 출간 상태
     * @return 본문 포함 [PostEntity], 없으면 `null`
     */
    fun findBySlugAndStatus(slug: String, status: PostStatus): PostEntity?

    /**
     * 익명 열람자가 본문을 읽어도 되는 출간 글만 조회.
     *
     * @param slug 정규화된 주소
     * @param status 출간 상태
     * @param visibility 공개 범위
     * @return 본문 포함 [PostEntity], 없으면 `null`
     */
    fun findBySlugAndStatusAndVisibility(slug: String, status: PostStatus, visibility: PostVisibility): PostEntity?

    /**
     * 익명 PUBLIC 상세에서 캐시보다 먼저 현재 공개 범위·해시를 본문 열 없이 조회.
     *
     * @param slug 정규화된 주소
     * @param status 출간 상태
     * @param visibility 공개 범위
     * @return 현재 공개 글의 [PublicPostCacheRow], 없으면 `null`
     */
    @Query("select new io.github.gjaku1031.kenblog.post.dto.PublicPostCacheRow(p.id, p.title, p.slug, p.publishedAt, p.bodySha256) " +
        "from PostEntity p where p.slug = :slug and p.status = :status and p.visibility = :visibility")
    fun findPublicCacheMetadataBySlug(
        @Param("slug") slug: String,
        @Param("status") status: PostStatus,
        @Param("visibility") visibility: PostVisibility,
    ): PublicPostCacheRow?

    /**
     * 익명 PRIVATE 직접 진입에 허용된 최소 열만 선택하고 본문 열을 읽지 않음.
     *
     * @param slug 정규화된 주소
     * @param status 출간 상태
     * @param visibility 비공개 범위
     * @return 잠금 화면용 [PrivatePostLockRow], 없으면 `null`
     */
    @Query("select new io.github.gjaku1031.kenblog.post.dto.PrivatePostLockRow(p.id, p.title, p.slug, p.publishedAt) " +
        "from PostEntity p where p.slug = :slug and p.status = :status and p.visibility = :visibility")
    fun findPrivateLockBySlug(
        @Param("slug") slug: String,
        @Param("status") status: PostStatus,
        @Param("visibility") visibility: PostVisibility,
    ): PrivatePostLockRow?
}
