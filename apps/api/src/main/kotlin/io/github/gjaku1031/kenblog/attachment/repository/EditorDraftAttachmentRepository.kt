package io.github.gjaku1031.kenblog.attachment.repository

import io.github.gjaku1031.kenblog.attachment.domain.EditorDraftAttachmentEntity
import io.github.gjaku1031.kenblog.attachment.domain.EditorDraftAttachmentId
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** 독립 편집본의 첨부 연결을 관리하고 삭제 경합을 확인하는 저장소. */
interface EditorDraftAttachmentRepository : JpaRepository<EditorDraftAttachmentEntity, EditorDraftAttachmentId> {
    /** @return 편집본에 선언된 첨부 ID의 오름차순 목록. */
    @Query("select l.key.attachmentId from EditorDraftAttachmentEntity l where l.key.editorDraftId = :draftId order by l.key.attachmentId")
    fun findIdsByDraftId(@Param("draftId") draftId: Long): List<Long>

    /**
     * 편집본 행을 잠근 쓰기 트랜잭션에서 RR의 첫 일반 SELECT 스냅샷을 피하고 현재 연결을 조회.
     * 엔티티 잠금 조회를 사용해 Hibernate의 스칼라 투영 잠금 제약도 피함.
     *
     * @return 편집본의 현재 연결 행을 첨부 ID 오름차순으로 잠근 목록
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select l from EditorDraftAttachmentEntity l where l.key.editorDraftId = :draftId order by l.key.attachmentId")
    fun findCurrentByDraftId(@Param("draftId") draftId: Long): List<EditorDraftAttachmentEntity>

    /** @return 해당 첨부가 어느 편집본에든 연결되었는지 여부. */
    @Query("select count(l) > 0 from EditorDraftAttachmentEntity l where l.key.attachmentId = :attachmentId")
    fun existsByAttachmentId(@Param("attachmentId") attachmentId: Long): Boolean

    /** @return 잠근 편집본의 기존 연결을 전체 교체하기 위해 제거한 행 수. */
    @Modifying(flushAutomatically = true)
    @Query("delete from EditorDraftAttachmentEntity l where l.key.editorDraftId = :draftId")
    fun deleteByDraftId(@Param("draftId") draftId: Long): Int
}
