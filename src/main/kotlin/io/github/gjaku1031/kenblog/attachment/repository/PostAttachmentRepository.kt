package io.github.gjaku1031.kenblog.attachment.repository

import io.github.gjaku1031.kenblog.attachment.domain.PostAttachmentEntity
import io.github.gjaku1031.kenblog.attachment.domain.PostAttachmentId
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/**
 * 게시글·첨부 연결 ID 조회와 전체 교체용 삭제
 */
interface PostAttachmentRepository : JpaRepository<PostAttachmentEntity, PostAttachmentId> {
    /**
     * 글에 선언된 첨부 ID의 오름차순 목록
     */
    @Query("select l.key.attachmentId from PostAttachmentEntity l where l.key.postId = :postId order by l.key.attachmentId")
    fun findIdsByPostId(@Param("postId") postId: Long): List<Long>

    /**
     * 잠근 글의 기존 연결을 전체 교체하기 위해 제거한 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query("delete from PostAttachmentEntity l where l.key.postId = :postId")
    fun deleteByPostId(@Param("postId") postId: Long): Int

}
