package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.category.dto.reference
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.post.repository.PostTagRepository
import org.springframework.stereotype.Component

/**
 * 본문 없이 얻은 게시글 페이지에 분류·태그를 고정된 두 SQL로 결합
 */
@Component
class PostTaxonomyMetadata(
    /**
     * 분류 저장소
     */
    private val categories: CategoryRepository,
    /**
     * 게시글 태그 저장소
     */
    private val tags: PostTagRepository
) {
    /**
     * 같은 인덱스의 글 ID·분류 ID를 일괄 조회하고 태그 순서 유지
     *
     * 1. 입력 길이 대조, 빈 페이지는 조회 없이 종료
     * 2. 분류·태그 일괄 조회
     * 3. 글 ID별 메타데이터 조립
     *
     * @param postIds 페이지 게시글 ID
     * @param categoryIds 각 글에 연결된 nullable 분류 ID
     * @return 게시글 ID별 분류 참조와 태그 이름
     */
    fun batch(postIds: List<Long>, categoryIds: List<Long?>): Map<Long, PostTaxonomyView> {
        check(postIds.size == categoryIds.size) { "Post taxonomy page IDs must align" }
        if (postIds.isEmpty()) return emptyMap()
        // 페이지의 분류를 중복 없이 일괄 조회
        val categoryMap = categories.findAllById(categoryIds.filterNotNull().distinct())
            .associate { (it.id ?: error("Persisted category has no ID")) to it.reference() }
        // 글별 태그를 저장 순서대로 일괄 조회
        val tagMap = tags.findRowsByPostIds(postIds).groupBy({ it.postId }, { it.name })
        // 같은 인덱스의 글·분류 ID를 응답 메타데이터로 연결
        return postIds.indices.associate { index ->
            postIds[index] to PostTaxonomyView(categoryIds[index]?.let(categoryMap::get), tagMap[postIds[index]].orEmpty())
        }
    }

    /**
     * 게시글 한 건의 현재 분류·태그를 일괄 조회 함수로 읽음
     */
    fun one(postId: Long, categoryId: Long?): PostTaxonomyView =
        batch(listOf(postId), listOf(categoryId)).getValue(postId)
}

/**
 * HTTP DTO를 조립할 때 사용하는 DB 현재 분류 참조와 정렬된 태그
 */
data class PostTaxonomyView(
    /**
     * 분류
     */
    val category: CategoryRefResponse?,
    /**
     * 태그 목록
     */
    val tags: List<String>
)
