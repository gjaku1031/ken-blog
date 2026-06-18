package io.github.gjaku1031.kenblog.draft.repository

import io.github.gjaku1031.kenblog.draft.domain.EditorDraftEntity
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftLockHint
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftSummaryRow
import jakarta.persistence.LockModeType
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

/** 편집본 단일 원본 제약·잠금 조회와 본문 없는 목록 투영을 제공하는 JPA 저장소. */
interface EditorDraftRepository : JpaRepository<EditorDraftEntity, Long> {
    /** @return 엔티티 1차 캐시를 채우지 않고 잠금 순서 결정에 쓸 원본·분류 ID. */
    @Query("select new io.github.gjaku1031.kenblog.draft.dto.EditorDraftLockHint(d.postId, d.categoryId) " +
        "from EditorDraftEntity d where d.id = :id")
    fun findLockHintById(@Param("id") id: Long): EditorDraftLockHint?

    /** @return 현재 수정/삭제/출간할 ID의 배타 잠금 행, 없으면 `null`. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from EditorDraftEntity d where d.id = :id")
    fun findLockedById(@Param("id") id: Long): EditorDraftEntity?

    /** @return 원본 행 잠금 후 같은 원본의 기존 편집본을 현재 읽기로 확인. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from EditorDraftEntity d where d.postId = :postId")
    fun findLockedByPostId(@Param("postId") postId: Long): EditorDraftEntity?

    /** @return 본문 열을 제외한 저장 시각·ID 내림차순 페이지. */
    @Query(
        value = "select new io.github.gjaku1031.kenblog.draft.dto.EditorDraftSummaryRow(" +
            "d.id, d.revision, d.postId, d.baseUpdatedAt, d.title, d.slug, d.categoryId, " +
            "d.tagsSnapshot, d.visibility, d.createdAt, d.updatedAt) from EditorDraftEntity d " +
            "where (:postId is null or d.postId = :postId) order by d.updatedAt desc, d.id desc",
        countQuery = "select count(d) from EditorDraftEntity d where (:postId is null or d.postId = :postId)",
    )
    fun findSummaries(@Param("postId") postId: Long?, pageable: Pageable): Page<EditorDraftSummaryRow>
}
