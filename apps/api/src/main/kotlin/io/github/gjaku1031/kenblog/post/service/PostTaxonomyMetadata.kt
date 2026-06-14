package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.category.dto.reference
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.post.repository.PostTagRepository
import org.springframework.stereotype.Component

/** 본문 없이 얻은 게시글 페이지에 분류·태그를 고정된 두 SQL로 결합. */
@Component
class PostTaxonomyMetadata(private val categories: CategoryRepository, private val tags: PostTagRepository) {
    /**
     * 같은 인덱스의 글 ID·분류 ID를 일괄 조회하고 태그 순서를 유지.
     *
     * @param postIds 페이지 게시글 ID
     * @param categoryIds 각 글에 연결된 nullable 분류 ID
     * @return 게시글 ID별 분류 참조와 태그 이름
     */
    fun batch(postIds: List<Long>, categoryIds: List<Long?>): Map<Long, PostTaxonomyView> {
        check(postIds.size == categoryIds.size) { "Post taxonomy page IDs must align" }
        if (postIds.isEmpty()) return emptyMap()
        val categoryMap = categories.findAllById(categoryIds.filterNotNull().distinct())
            .associate { (it.id ?: error("Persisted category has no ID")) to it.reference() }
        val tagMap = tags.findRowsByPostIds(postIds).groupBy({ it.postId }, { it.name })
        return postIds.indices.associate { index ->
            postIds[index] to PostTaxonomyView(categoryIds[index]?.let(categoryMap::get), tagMap[postIds[index]].orEmpty())
        }
    }

    /** @return 게시글 한 건의 현재 분류·태그를 일괄 조회 함수로 읽음. */
    fun one(postId: Long, categoryId: Long?): PostTaxonomyView =
        batch(listOf(postId), listOf(categoryId)).getValue(postId)
}

/** HTTP DTO를 조립할 때 사용하는 DB 현재 분류 참조와 정렬된 태그. */
data class PostTaxonomyView(val category: CategoryRefResponse?, val tags: List<String>)
