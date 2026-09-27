package io.github.gjaku1031.kenblog.project.repository

import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.project.dto.ProjectDocumentRow
import io.github.gjaku1031.kenblog.project.dto.ProjectRelatedTechRow
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminDocumentResponse
import jakarta.persistence.LockModeType
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** 프로젝트용 본문 없는 문서·관련 Tech 조회와 부모 잠금 아래 글 조작을 모은 JPA 저장소. */
interface ProjectPostRepository : JpaRepository<PostEntity, Long> {
    /** @return 삭제할 모든 HOME·DOC 식별자를 본문 없이 조회. */
    @Query("select p.id from PostEntity p where p.projectId = :projectId order by p.id asc")
    fun findProjectPostIds(@Param("projectId") projectId: Long): List<Long>

    /** @return 관리자 순서 편집을 위한 본문 없는 전체 DOC 행. */
    @Query("select new io.github.gjaku1031.kenblog.project.dto.ProjectAdminDocumentResponse(" +
        "p.id, p.title, p.slug, p.documentOrder, p.status, p.visibility) from PostEntity p " +
        "where p.projectId = :projectId and p.section = :section order by p.documentOrder asc, p.id asc")
    fun findAdminDocuments(@Param("projectId") projectId: Long,
        @Param("section") section: PostSection): List<ProjectAdminDocumentResponse>

    /** @return 잠긴 부모의 DOC 저장 순서만 변경한 행 수. */
    @org.springframework.data.jpa.repository.Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PostEntity p set p.documentOrder = :order where p.id = :id and p.projectId = :projectId " +
        "and p.section = :section")
    fun updateDocumentOrder(@Param("id") id: Long, @Param("projectId") projectId: Long,
        @Param("section") section: PostSection, @Param("order") order: Int): Int
    /** @return 현재 권한으로 보이는 출간 문서의 본문 없는 순서 목록. */
    @Query("select new io.github.gjaku1031.kenblog.project.dto.ProjectDocumentRow(" +
        "p.id, p.title, p.slug, p.documentOrder, p.publishedAt, p.visibility) " +
        "from PostEntity p where p.projectId = :projectId and p.section = :section and p.status = :published " +
        "and (:includePrivate = true or p.visibility = :publicVisibility) order by p.documentOrder asc, p.id asc")
    fun findPublishedDocuments(@Param("projectId") projectId: Long, @Param("section") section: PostSection,
        @Param("published") published: PostStatus, @Param("includePrivate") includePrivate: Boolean,
        @Param("publicVisibility") publicVisibility: PostVisibility): List<ProjectDocumentRow>

    /** @return 공개 프로젝트 카드 집계를 위한 권한별 문서 수. */
    @Query("select count(p) from PostEntity p where p.projectId = :projectId and p.section = :section " +
        "and p.status = :published and (:includePrivate = true or p.visibility = :publicVisibility)")
    fun countPublishedDocuments(@Param("projectId") projectId: Long, @Param("section") section: PostSection,
        @Param("published") published: PostStatus, @Param("includePrivate") includePrivate: Boolean,
        @Param("publicVisibility") publicVisibility: PostVisibility): Long

    /** @return 현재 권한으로 보이는 관련 TECH 글의 본문 없는 최초 출간일 역순 페이지. */
    @Query(value = "select new io.github.gjaku1031.kenblog.project.dto.ProjectRelatedTechRow(" +
        "p.id, p.title, p.slug, p.publishedAt, p.visibility) from PostEntity p " +
        "where p.relatedProjectId = :projectId and p.section = :tech and p.status = :published " +
        "and (:includePrivate = true or p.visibility = :publicVisibility) order by p.publishedAt desc, p.id desc",
        countQuery = "select count(p) from PostEntity p where p.relatedProjectId = :projectId " +
            "and p.section = :tech and p.status = :published " +
            "and (:includePrivate = true or p.visibility = :publicVisibility)")
    fun findRelatedTech(@Param("projectId") projectId: Long, @Param("tech") tech: PostSection,
        @Param("published") published: PostStatus, @Param("includePrivate") includePrivate: Boolean,
        @Param("publicVisibility") publicVisibility: PostVisibility, pageable: Pageable): Page<ProjectRelatedTechRow>

    /** @return 부모 행을 먼저 잠근 뒤 현재 문서 행을 잠그는 조회. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PostEntity p where p.id = :id and p.projectId = :projectId")
    fun findLockedProjectPost(@Param("id") id: Long, @Param("projectId") projectId: Long): PostEntity?

    /** @return 새 문서를 부모 잠금 아래 끝에 배치할 현재 최댓값. */
    @Query("select max(p.documentOrder) from PostEntity p where p.projectId = :projectId and p.section = :section")
    fun maxDocumentOrder(@Param("projectId") projectId: Long, @Param("section") section: PostSection): Int?
}
