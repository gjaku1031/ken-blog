package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.draft.repository.EditorDraftWikiLinkRepository
import io.github.gjaku1031.kenblog.post.domain.EditorDraftWikiLinkEntity
import io.github.gjaku1031.kenblog.post.domain.PostWikiLinkEntity
import io.github.gjaku1031.kenblog.post.dto.WikiDeclarations
import io.github.gjaku1031.kenblog.post.repository.PostWikiLinkRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 본문과 함께 관리자가 선언한 제목 연결을 원본·편집본별 트랜잭션에서 관리. */
@Service
class WikiLinkMetadata(
    private val posts: PostWikiLinkRepository,
    private val drafts: EditorDraftWikiLinkRepository,
) {
    /** @return 게시글의 저장 순서대로 정렬된 대상 제목. */
    @Transactional(readOnly = true)
    fun postTitles(postId: Long): List<String> = posts.findTitles(postId)

    /** @return 편집본의 저장 순서대로 정렬된 대상 제목. */
    @Transactional(readOnly = true)
    fun draftTitles(draftId: Long): List<String> = drafts.findTitles(draftId)

    /**
     * 잠긴 편집본 행을 얻은 뒤 현재 읽기로 선언을 조회해 RR 스냅샷의 오래된 값 사용을 피함.
     * @return 지금 저장된 대상 제목
     */
    @Transactional(readOnly = true)
    fun currentDraftTitles(draftId: Long): List<String> = drafts.findCurrent(draftId).map { it.targetTitle }

    /** 부모 게시글 행을 잠근 트랜잭션에서 선언 전부를 교체. */
    @Transactional
    fun replacePost(postId: Long, titles: List<String>) {
        val normalized = WikiDeclarations.normalized(titles)
        posts.deleteByPostId(postId)
        if (normalized.isNotEmpty()) posts.saveAllAndFlush(normalized.mapIndexed { index, title -> PostWikiLinkEntity(postId, index, title) })
    }

    /** 부모 편집본 행을 잠근 트랜잭션에서 선언 전부를 교체. */
    @Transactional
    fun replaceDraft(draftId: Long, titles: List<String>) {
        val normalized = WikiDeclarations.normalized(titles)
        drafts.deleteByDraftId(draftId)
        if (normalized.isNotEmpty()) drafts.saveAllAndFlush(normalized.mapIndexed { index, title -> EditorDraftWikiLinkEntity(draftId, index, title) })
    }

    /** 잠근 편집본의 현재 선언을 같은 출간 트랜잭션의 게시글로 복사. */
    @Transactional
    fun publishDraft(postId: Long, draftId: Long) = replacePost(postId, currentDraftTitles(draftId))
}
