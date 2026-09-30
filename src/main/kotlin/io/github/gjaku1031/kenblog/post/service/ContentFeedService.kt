package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.content.service.RepositoryMarkdown
import io.github.gjaku1031.kenblog.note.repository.CoursePostRepository
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.TagNames
import io.github.gjaku1031.kenblog.post.dto.ContentFeedItem
import io.github.gjaku1031.kenblog.post.dto.ContentFeedPage
import io.github.gjaku1031.kenblog.post.dto.ContentFeedRow
import io.github.gjaku1031.kenblog.post.repository.ContentFeedRepository
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale
import org.springframework.data.domain.PageRequest
import org.springframework.data.repository.findByIdOrNull
import org.springframework.security.core.Authentication
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** PUBLIC 혼합 피드와 검색을 묶는 서비스. */
@Service
class ContentFeedService(private val feeds: ContentFeedRepository, private val posts: PostRepository,
    private val categories: CategoryRepository, private val taxonomy: PostTaxonomyMetadata,
    private val chapters: CoursePostRepository, private val markdown: RepositoryMarkdown) {
    /** @return 전체에는 프로젝트 문서를 포함하고 Tech/Notes 구획에서는 해당 글만 조회한 최신 페이지. */
    @Transactional(readOnly = true)
    fun feed(section: String, page: Int, size: Int, categoryId: Long?, tag: String?,
        authentication: Authentication?): ContentFeedPage {
        validatePage(page, size)
        val selected = when (section.lowercase(Locale.ROOT)) {
            "all" -> null
            "tech" -> PostSection.TECH
            "notes" -> PostSection.NOTE_CHAPTER
            else -> throw InvalidPostRequestException()
        }
        if (categoryId != null && categoryId <= 0) throw InvalidPostRequestException()
        val category = categoryId?.let { categories.findByIdOrNull(it)
            ?: return ContentFeedPage(emptyList(), page, size, 0, 0) }
        val path = category?.path
        val normalizedTag = tag?.takeIf(String::isNotBlank)?.let(TagNames::normalize)
        val result = feeds.feed(PostStatus.PUBLISHED, PostSection.TECH, PostSection.NOTE_CHAPTER,
            PostSection.PROJECT_DOC, selected, PostSection.PROJECT_HOME, PostVisibility.PUBLIC,
            false,
            category?.depth == 3,
            path, path?.let { "$it/%" }, normalizedTag, PageRequest.of(page, size))
        return page(result.content, page, size, result.totalElements, result.totalPages, false)
    }

    /** @return 제목·본문·태그·분류·과목 정보에 실제 문자열이 있는 공개 글 페이지. */
    @Transactional(readOnly = true)
    fun search(query: String, page: Int, size: Int, authentication: Authentication?): ContentFeedPage {
        validatePage(page, size)
        val normalized = query.trim().lowercase(Locale.ROOT)
        if (normalized.codePointCount(0, normalized.length) !in 1..100 ||
            normalized.any(Character::isISOControl)) throw InvalidPostRequestException()
        val matches = mutableListOf<ContentFeedRow>()
        var batch = 0
        do {
            val result = feeds.feed(PostStatus.PUBLISHED, PostSection.TECH, PostSection.NOTE_CHAPTER,
                PostSection.PROJECT_DOC, null, PostSection.PROJECT_HOME, PostVisibility.PUBLIC,
                false, false, null, null, null, PageRequest.of(batch++, 200))
            val rows = result.content.filter { it.section != PostSection.PROJECT_HOME }
            val views = taxonomy.batch(rows.map { it.id }, rows.map { it.categoryId })
            rows.forEach { row ->
                val view = views.getValue(row.id)
                val metadata = listOfNotNull(row.title, row.summary, row.projectName, row.courseName,
                    row.courseField, view.category?.path, view.category?.name).plus(view.tags)
                if (metadata.any { it.lowercase(Locale.ROOT).contains(normalized) } ||
                    posts.findByIdOrNull(row.id)?.let { markdown.readPost(it).lowercase(Locale.ROOT).contains(normalized) } == true)
                    matches += row
            }
        } while (result.hasNext())
        val from = page * size
        val selected = if (from >= matches.size) emptyList() else matches.drop(from).take(size)
        return page(selected, page, size, matches.size.toLong(), (matches.size + size - 1) / size, false)
    }

    /** @return 본문 없는 페이지에 일괄 taxonomy와 권한별 회차 번호를 결합. */
    private fun page(rows: List<ContentFeedRow>, page: Int, size: Int, total: Long, pages: Int,
        includePrivate: Boolean): ContentFeedPage {
        val views = taxonomy.batch(rows.map { it.id }, rows.map { it.categoryId })
        val positions = rows.mapNotNull { it.courseId }.distinct().associateWith { id ->
            chapters.findVisibleChapters(id, PostSection.NOTE_CHAPTER, PostStatus.PUBLISHED,
                includePrivate, PostVisibility.PUBLIC).map { it.id }
        }
        val techSeries = rows.filter { it.section == PostSection.TECH }.mapNotNull { it.categoryId }.distinct()
            .mapNotNull { id ->
                val category = categories.findByIdOrNull(id)
                if (category?.depth != 3) null else id to posts.findTechSeries(id, PostSection.TECH,
                    PostStatus.PUBLISHED, includePrivate, PostVisibility.PUBLIC).map { it.id }
            }.toMap()
        return ContentFeedPage(rows.map { row ->
            val view = views.getValue(row.id)
            val siblings = row.courseId?.let(positions::get)
            val series = if (row.section == PostSection.TECH) row.categoryId?.let(techSeries::get) else siblings
            val seriesPosition = series?.indexOf(row.id)?.takeIf { it >= 0 }?.plus(1)
            ContentFeedItem(row.id, row.title, row.slug, row.section, row.summary,
                row.publishedAt.atZone(ZoneOffset.UTC).withZoneSameInstant(SEOUL).toLocalDate(),
                row.visibility, view.category, view.tags, row.projectSlug, row.courseSlug,
                row.projectName, row.courseName, row.courseField,
                siblings?.indexOf(row.id)?.takeIf { it >= 0 }?.plus(1), siblings?.size,
                if ((series?.size ?: 0) > 1) seriesPosition else null,
                series?.size?.takeIf { it > 1 }, row.techSeriesOrder)
        }, page, size, total, pages)
    }

    /** SQL 페이지와 오프셋을 제한. */
    private fun validatePage(page: Int, size: Int) {
        if (page < 0 || size !in 1..100 || page.toLong() * size > Int.MAX_VALUE)
            throw InvalidPostRequestException()
    }

    private companion object { val SEOUL: ZoneId = ZoneId.of("Asia/Seoul") }
}
