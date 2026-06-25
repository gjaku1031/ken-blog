package io.github.gjaku1031.kenblog.attachment.repository

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentStatus
import io.github.gjaku1031.kenblog.attachment.domain.PostAttachmentEntity
import io.github.gjaku1031.kenblog.attachment.domain.PostAttachmentId
import io.github.gjaku1031.kenblog.attachment.dto.AttachmentDeliveryRow
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.transaction.annotation.Transactional

/** 글별 첨부 연결과 본문 없는 공개 전달 권한 조회. */
interface PostAttachmentRepository : JpaRepository<PostAttachmentEntity, PostAttachmentId> {
    /** @return 글에 선언된 첨부 ID의 오름차순 목록. */
    @Query("select l.key.attachmentId from PostAttachmentEntity l where l.key.postId = :postId order by l.key.attachmentId")
    fun findIdsByPostId(@Param("postId") postId: Long): List<Long>

    /** @return 해당 첨부가 어느 글에든 연결되었는지 여부. */
    @Query("select count(l) > 0 from PostAttachmentEntity l where l.key.attachmentId = :attachmentId")
    fun existsByAttachmentId(@Param("attachmentId") attachmentId: Long): Boolean

    /** @return 잠근 글의 기존 연결을 전체 교체하기 위해 제거한 행 수. */
    @Modifying(flushAutomatically = true)
    @Query("delete from PostAttachmentEntity l where l.key.postId = :postId")
    fun deleteByPostId(@Param("postId") postId: Long): Int

    /** @return 현재 글 권한·연결·READY가 모두 맞는 객체의 비공개 내부 위치와 안전한 MIME·길이. */
    @Query("select new io.github.gjaku1031.kenblog.attachment.dto.AttachmentDeliveryRow(a.objectKey, a.contentType, a.byteSize) " +
        "from PostAttachmentEntity l, PostEntity p, AttachmentEntity a where l.key.postId = :postId " +
        "and l.key.attachmentId = :attachmentId and p.id = l.key.postId and a.id = l.key.attachmentId " +
        "and p.status = :published and (:includePrivate = true or p.visibility = :publicVisibility) and a.status = :ready")
    @Transactional(readOnly = true)
    fun findReadable(
        @Param("postId") postId: Long,
        @Param("attachmentId") attachmentId: Long,
        @Param("published") published: PostStatus,
        @Param("publicVisibility") publicVisibility: PostVisibility,
        @Param("includePrivate") includePrivate: Boolean,
        @Param("ready") ready: AttachmentStatus,
    ): AttachmentDeliveryRow?
}
