package io.github.gjaku1031.kenblog.project.repository

import io.github.gjaku1031.kenblog.project.domain.ProjectEntity
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import org.springframework.data.repository.query.Param

/** 프로젝트 대문 속성과 부모 우선 잠금 조회를 담당하는 JPA 저장소. */
interface ProjectRepository : JpaRepository<ProjectEntity, Long> {
    /** @return 고유 주소와 일치하는 프로젝트, 없으면 `null`. */
    fun findBySlug(slug: String): ProjectEntity?

    /** @return 자식 게시글보다 먼저 배타 잠금한 현재 프로젝트 행. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from ProjectEntity p where p.id = :id")
    fun findLockedById(@Param("id") id: Long): ProjectEntity?

    /** @return 자식 게시글이 부모 삭제와 경합하지 않도록 공유 잠금한 행. */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select p from ProjectEntity p where p.id = :id")
    fun findSharedById(@Param("id") id: Long): ProjectEntity?

    /** @return HOME 원문이 출간됐고 현재 역할에 노출되는 프로젝트 페이지. */
    @Query(value = "select p from ProjectEntity p, PostEntity h where h.id = p.homePostId " +
        "and h.status = :published and (:includePrivate = true or (p.visibility = :publicVisibility and h.visibility = :publicVisibility)) " +
        "order by p.createdAt desc, p.id desc",
        countQuery = "select count(p) from ProjectEntity p, PostEntity h where h.id = p.homePostId " +
            "and h.status = :published and (:includePrivate = true or (p.visibility = :publicVisibility and h.visibility = :publicVisibility))")
    fun findVisible(@Param("published") published: PostStatus, @Param("includePrivate") includePrivate: Boolean,
        @Param("publicVisibility") publicVisibility: PostVisibility, pageable: Pageable): Page<ProjectEntity>

    /** @return 관리자의 공개·비공개 프로젝트 페이지. */
    @Query(value = "select p from ProjectEntity p order by p.createdAt desc, p.id desc",
        countQuery = "select count(p) from ProjectEntity p")
    fun findAdminPage(pageable: Pageable): Page<ProjectEntity>
}
