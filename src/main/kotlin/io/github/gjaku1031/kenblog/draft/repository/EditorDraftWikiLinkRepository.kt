package io.github.gjaku1031.kenblog.draft.repository

import io.github.gjaku1031.kenblog.post.domain.EditorDraftWikiLinkEntity
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** 잠근 편집본의 비공개 제목 참조를 읽고 전체 교체하는 JPA 저장소. */
interface EditorDraftWikiLinkRepository : JpaRepository<EditorDraftWikiLinkEntity, Long> {
    /** @return 선언 순서의 대상 제목. */
    @Query("select w.targetTitle from EditorDraftWikiLinkEntity w where w.editorDraftId = :draftId order by w.position")
    fun findTitles(@Param("draftId") draftId: Long): List<String>

    /** 잠근 편집본 뒤 현재 읽기로 출간할 선언 행을 가져와 오래된 RR 스냅샷을 피함. */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select w from EditorDraftWikiLinkEntity w where w.editorDraftId = :draftId order by w.position")
    fun findCurrent(@Param("draftId") draftId: Long): List<EditorDraftWikiLinkEntity>

    /** @return 편집본에 속했던 선언을 교체하기 위해 제거한 행 수. */
    @Modifying(flushAutomatically = true)
    @Query("delete from EditorDraftWikiLinkEntity w where w.editorDraftId = :draftId")
    fun deleteByDraftId(@Param("draftId") draftId: Long): Int
}
