package io.github.gjaku1031.kenblog.post.repository

import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.dto.PostSummaryResponse
import io.github.gjaku1031.kenblog.post.service.PostService
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

/**
 * [PostEntity]의 기본 저장·ID 조회를 [JpaRepository]에 맡기는 게시글 저장소.
 *
 * [PostService.createDraft]는 새 엔티티의 null ID를 유지한 채
 * [JpaRepository.saveAndFlush]를 호출하여 제약 오류를 트랜잭션 안에서 확인함.
 * ID 조회는 [JpaRepository.findById]를 사용함.
 */
interface PostRepository : JpaRepository<PostEntity, Long> {
    /**
     * 저장된 slug와 정확히 일치하는 초안을 파생 쿼리로 조회.
     *
     * @param slug 정규화된 소문자 ASCII slug
     * @return 일치하는 [PostEntity], 없으면 `null`
     */
    fun findBySlug(slug: String): PostEntity?

    /**
     * 본문 열을 읽지 않고 관리자 초안 목록의 한 페이지를 생성자 DTO로 조회.
     *
     * @param pageable 검증된 0 기반 페이지와 크기; 정렬은 쿼리에 고정됨
     * @return 생성 시각·ID 내림차순의 [PostSummaryResponse] 페이지
     */
    @Query(
        value = "select new io.github.gjaku1031.kenblog.post.dto.PostSummaryResponse(p.id, p.title, p.slug, p.createdAt, p.updatedAt) " +
            "from PostEntity p order by p.createdAt desc, p.id desc",
        countQuery = "select count(p) from PostEntity p",
    )
    fun findAdminSummaries(pageable: Pageable): Page<PostSummaryResponse>
}
