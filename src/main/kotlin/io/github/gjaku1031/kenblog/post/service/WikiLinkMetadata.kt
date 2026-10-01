package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.post.domain.PostWikiLinkEntity
import io.github.gjaku1031.kenblog.post.dto.WikiDeclarations
import io.github.gjaku1031.kenblog.post.repository.PostWikiLinkRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 관리자가 선언한 게시글의 위키 대상 제목을 트랜잭션에서 관리. */
@Service
class WikiLinkMetadata(
    private val posts: PostWikiLinkRepository,
) {
    /** @return 게시글의 저장 순서대로 정렬된 대상 제목. */
    @Transactional(readOnly = true)
    fun postTitles(postId: Long): List<String> = posts.findTitles(postId)

    /** 부모 게시글 행을 잠근 트랜잭션에서 선언 전부를 교체. */
    @Transactional
    fun replacePost(postId: Long, titles: List<String>) {
        val normalized = WikiDeclarations.normalized(titles)
        posts.deleteByPostId(postId)
        if (normalized.isNotEmpty()) posts.saveAllAndFlush(normalized.mapIndexed { index, title -> PostWikiLinkEntity(postId, index, title) })
    }

}
