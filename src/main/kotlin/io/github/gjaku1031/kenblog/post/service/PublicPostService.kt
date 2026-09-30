package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.content.service.RepositoryMarkdown
import io.github.gjaku1031.kenblog.note.repository.CoursePostRepository
import io.github.gjaku1031.kenblog.note.repository.CourseRepository
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostBodyHash
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.TagNames
import io.github.gjaku1031.kenblog.post.dto.PostSeriesItem
import io.github.gjaku1031.kenblog.post.dto.PostSeriesResponse
import io.github.gjaku1031.kenblog.post.dto.PublicPostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PublicPostPageResponse
import io.github.gjaku1031.kenblog.post.dto.PublicPostSummaryResponse
import io.github.gjaku1031.kenblog.post.dto.PublishedPostRow
import io.github.gjaku1031.kenblog.post.dto.TagCountResponse
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import io.github.gjaku1031.kenblog.post.repository.PostTagRepository
import io.github.gjaku1031.kenblog.project.repository.ProjectRepository
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

/** 출간된 PUBLIC 원문만 DB에서 읽어 정적 사이트 생성에 제공. */
@Service
class PublicPostService(
    private val repository: PostRepository,
    private val categories: CategoryRepository,
    private val taxonomy: PostTaxonomyMetadata,
    private val tags: PostTagRepository,
    private val projects: ProjectRepository,
    private val courses: CourseRepository,
    private val coursePosts: CoursePostRepository,
    private val markdown: RepositoryMarkdown,
) {
    @Transactional(readOnly = true)
    fun list(page: Int, size: Int, authentication: Authentication?, categoryId: Long?, tag: String?): PublicPostPageResponse {
        if (page < 0 || size !in 1..100 || page.toLong() * size > Int.MAX_VALUE || categoryId != null && categoryId <= 0)
            throw InvalidPostRequestException()
        val category = categoryId?.let { categories.findByIdOrNull(it)
            ?: return PublicPostPageResponse(emptyList(), page, size, 0, 0) }
        val path = category?.path
        val result = repository.findPublishedSummaries(PostStatus.PUBLISHED, PostVisibility.PUBLIC, false,
            category?.depth == 3, path, path?.let { "$it/%" }, tag?.let(TagNames::normalize), PageRequest.of(page, size))
        val views = taxonomy.batch(result.content.map { it.id }, result.content.map { it.categoryId })
        return PublicPostPageResponse(result.content.map { it.summary(views.getValue(it.id)) }, page, size,
            result.totalElements, result.totalPages)
    }

    @Transactional(readOnly = true)
    fun detail(slug: String, authentication: Authentication?): PublicPostDetailResponse {
        val normalized = slug.trim().lowercase(Locale.ROOT)
        if (normalized.length > 160 || !SLUG_PATTERN.matches(normalized)) throw PostNotFoundException()
        val post = repository.findBySlugAndStatusAndVisibility(normalized, PostStatus.PUBLISHED,
            PostVisibility.PUBLIC, PostSection.TECH, PostSection.NOTE_CHAPTER, PostSection.PROJECT_HOME)
            ?: throw PostNotFoundException()
        return post.publicDetail()
    }

    @Transactional(readOnly = true)
    fun tags(authentication: Authentication?): List<TagCountResponse> =
        tags.findPublicCounts(PostStatus.PUBLISHED, PostVisibility.PUBLIC, false)

    private fun PostEntity.publicDetail(): PublicPostDetailResponse {
        val postId = id ?: error("Published post has no ID")
        val view = taxonomy.one(postId, categoryId)
        val project = projectId?.let(projects::findByIdOrNull)
        val course = courseId?.let(courses::findByIdOrNull)
        val related = relatedProjectId?.let { repository.findReadableProject(it, PostSection.PROJECT_HOME,
            PostStatus.PUBLISHED, PostVisibility.PUBLIC, false) }
        val fileBody = markdown.readPost(this)
        return PublicPostDetailResponse(postId, title, slug, publishedAt.kstDate(), false, fileBody,
            view.category, view.tags, section, project?.slug, related, course?.slug, PostBodyHash.sha256(fileBody),
            series(postId, section, categoryId, courseId), summary = summary, techSeriesOrder = techSeriesOrder)
    }

    private fun PublishedPostRow.summary(view: PostTaxonomyView): PublicPostSummaryResponse =
        PublicPostSummaryResponse(id, title, slug, publishedAt.kstDate(), view.category, view.tags)

    private fun series(postId: Long, section: PostSection, categoryId: Long?, courseId: Long?): PostSeriesResponse? {
        val items = when (section) {
            PostSection.TECH -> {
                val category = categoryId?.let(categories::findByIdOrNull)
                if (category?.depth != 3) return null
                repository.findTechSeries(categoryId, PostSection.TECH, PostStatus.PUBLISHED,
                    false, PostVisibility.PUBLIC).mapIndexed { index, row ->
                    PostSeriesItem(row.id, row.slug, row.title, index + 1)
                }
            }
            PostSection.NOTE_CHAPTER -> {
                if (courseId == null) return null
                coursePosts.findVisibleChapters(courseId, PostSection.NOTE_CHAPTER, PostStatus.PUBLISHED,
                    false, PostVisibility.PUBLIC).mapIndexed { index, row ->
                    PostSeriesItem(row.id, row.slug, row.title, index + 1)
                }
            }
            else -> return null
        }
        if (items.size < 2) return null
        val position = items.indexOfFirst { it.id == postId } + 1
        return if (position > 0) PostSeriesResponse(items, position) else null
    }

    private fun LocalDateTime?.kstDate(): LocalDate =
        (this ?: error("Published post has no publication time"))
            .atZone(ZoneOffset.UTC).withZoneSameInstant(SEOUL).toLocalDate()

    private companion object {
        val SLUG_PATTERN = Regex("[a-z0-9]+(?:-[a-z0-9]+)*")
        val SEOUL: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
