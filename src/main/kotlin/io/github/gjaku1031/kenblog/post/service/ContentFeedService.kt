package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.dto.ContentFeedPage
import io.github.gjaku1031.kenblog.post.repository.PostQueries
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import io.github.gjaku1031.kenblog.post.repository.PostRow
import io.github.gjaku1031.kenblog.content.service.RepositoryMarkdown
import io.github.gjaku1031.kenblog.series.domain.SeriesKind
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.security.core.Authentication
import org.springframework.data.repository.findByIdOrNull
import java.util.Locale

/** 공통 메타데이터 목록과 저장소 Markdown 본문 검색. */
@Service
class ContentFeedService(private val queries: PostQueries, private val publicPosts: PublicPostService,
    private val posts: PostRepository, private val taxonomy: PostTaxonomyMetadata, private val markdown: RepositoryMarkdown) {
    @Transactional(readOnly = true)
    fun feed(section: String, page: Int, size: Int, categoryId: Long?, tag: String?, authentication: Authentication?): ContentFeedPage {
        val kind = when (section) { "all" -> null; "posts" -> SeriesKind.TECH; "projects" -> SeriesKind.PROJECT
            else -> throw InvalidPostRequestException() }
        return publicPosts.list(page, size, authentication, categoryId, tag, kind)
    }
    @Transactional(readOnly = true)
    fun search(query: String, page: Int, size: Int, authentication: Authentication?): ContentFeedPage {
        publicPosts.validatePage(page, size)
        val text = query.trim().lowercase(Locale.ROOT)
        if (text.codePointCount(0, text.length) !in 1..100 || text.any(Character::isISOControl)) throw InvalidPostRequestException()
        val matches = mutableListOf<PostRow>()
        var batch = 0
        do {
            val result = queries.publicPage(batch++, 100)
            val views = taxonomy.batch(result.items.map { it.id }, result.items.map { it.categoryId })
            for (row in result.items) {
                val view = views.getValue(row.id)
                val metadata = listOfNotNull(row.title, row.summary, row.series?.name, view.category?.path, view.category?.name) + view.tags
                if (metadata.any { it.lowercase(Locale.ROOT).contains(text) } ||
                    posts.findByIdOrNull(row.id)?.let { markdown.readPost(it).lowercase(Locale.ROOT).contains(text) } == true) matches += row
            }
        } while (batch < result.pages)
        return ContentFeedPage(publicPosts.summaries(matches.drop(page * size).take(size)), page, size,
            matches.size.toLong(), (matches.size + size - 1) / size)
    }
}
