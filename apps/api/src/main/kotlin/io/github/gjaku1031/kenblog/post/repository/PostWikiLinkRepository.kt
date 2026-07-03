package io.github.gjaku1031.kenblog.post.repository

import io.github.gjaku1031.kenblog.post.domain.PostWikiLinkEntity
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** 잠근 게시글의 명시적 제목 참조를 읽고 전체 교체하는 JPA 저장소. */
interface PostWikiLinkRepository : JpaRepository<PostWikiLinkEntity, Long> {
    /** @return 본문을 읽지 않은 선언 순서의 대상 제목. */
    @Query("select w.targetTitle from PostWikiLinkEntity w where w.postId = :postId order by w.position")
    fun findTitles(@Param("postId") postId: Long): List<String>

    /** @return 글에 속했던 선언을 교체하기 위해 제거한 행 수. */
    @Modifying(flushAutomatically = true)
    @Query("delete from PostWikiLinkEntity w where w.postId = :postId")
    fun deleteByPostId(@Param("postId") postId: Long): Int
}
