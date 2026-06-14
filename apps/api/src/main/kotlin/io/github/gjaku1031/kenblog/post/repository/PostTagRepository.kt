package io.github.gjaku1031.kenblog.post.repository

import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostTagEntity
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.PostTagRow
import io.github.gjaku1031.kenblog.post.dto.TagCountResponse
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** FK 태그 행의 전체 교체·페이지 일괄 조회·권한별 SQL 사용량 집계 저장소. */
interface PostTagRepository : JpaRepository<PostTagEntity, Long> {
    /** @return 게시글 한 건의 0 기반 순서 태그 이름. */
    @Query("select t.name from PostTagEntity t where t.postId = :postId order by t.position asc")
    fun findNamesByPostId(@Param("postId") postId: Long): List<String>

    /** @return 페이지 전체 글의 태그를 본문 없이 한 번에 조회한 [PostTagRow] 목록. */
    @Query("select new io.github.gjaku1031.kenblog.post.dto.PostTagRow(t.postId, t.position, t.name) " +
        "from PostTagEntity t where t.postId in :postIds order by t.postId asc, t.position asc")
    fun findRowsByPostIds(@Param("postIds") postIds: Collection<Long>): List<PostTagRow>

    /** @return 잠근 글의 기존 태그를 전체 교체하기 위해 지운 행 수. */
    @Modifying(flushAutomatically = true)
    @Query("delete from PostTagEntity t where t.postId = :postId")
    fun deleteByPostId(@Param("postId") postId: Long): Int

    /** @return 현재 역할에서 보이는 출간 글의 태그별 사용 글 수. */
    @Query("select new io.github.gjaku1031.kenblog.post.dto.TagCountResponse(t.name, count(t)) " +
        "from PostTagEntity t, PostEntity p where t.postId = p.id and p.status = :published " +
        "and (:includePrivate = true or p.visibility = :publicVisibility) " +
        "group by t.name order by count(t) desc, t.name asc")
    fun findPublicCounts(
        @Param("published") published: PostStatus,
        @Param("publicVisibility") publicVisibility: PostVisibility,
        @Param("includePrivate") includePrivate: Boolean,
    ): List<TagCountResponse>

    /** @return 초안을 포함한 관리자 자동완성의 태그별 사용 글 수. */
    @Query("select new io.github.gjaku1031.kenblog.post.dto.TagCountResponse(t.name, count(t)) " +
        "from PostTagEntity t group by t.name order by count(t) desc, t.name asc")
    fun findAdminCounts(): List<TagCountResponse>
}
