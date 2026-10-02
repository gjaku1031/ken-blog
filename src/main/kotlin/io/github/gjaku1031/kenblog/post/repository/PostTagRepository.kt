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

/**
 * 게시글 태그 저장·일괄 조회·전체 교체
 */
interface PostTagRepository : JpaRepository<PostTagEntity, Long> {
    /**
     * [PostTagEntity.displayName]의 입력 대소문자를 보존한 0 기반 순서 태그 이름
     */
    @Query("select t.displayName from PostTagEntity t where t.postId = :postId order by t.position asc")
    fun findNamesByPostId(@Param("postId") postId: Long): List<String>

    /**
     * 페이지 전체 글의 태그를 본문 없이 한 번에 조회한 [PostTagRow] 목록
     */
    @Query("select new io.github.gjaku1031.kenblog.post.dto.PostTagRow(t.postId, t.position, t.displayName) " +
        "from PostTagEntity t where t.postId in :postIds order by t.postId asc, t.position asc")
    fun findRowsByPostIds(@Param("postIds") postIds: Collection<Long>): List<PostTagRow>

    /**
     * 잠근 글의 기존 태그를 전체 교체하기 위해 지운 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query("delete from PostTagEntity t where t.postId = :postId")
    fun deleteByPostId(@Param("postId") postId: Long): Int

}
