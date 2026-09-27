package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.note.repository.CoursePostRepository
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.TagNames
import io.github.gjaku1031.kenblog.post.dto.ActivityDayResponse
import io.github.gjaku1031.kenblog.post.dto.ActivityResponse
import io.github.gjaku1031.kenblog.post.dto.ContentFeedItem
import io.github.gjaku1031.kenblog.post.dto.ContentFeedPage
import io.github.gjaku1031.kenblog.post.dto.ContentFeedRow
import io.github.gjaku1031.kenblog.post.dto.PinOrderResponse
import io.github.gjaku1031.kenblog.post.repository.ContentFeedRepository
import io.github.gjaku1031.kenblog.post.repository.ContentStateRepository
import io.github.gjaku1031.kenblog.post.repository.PostRepository
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

/** Home 혼합 피드·검색·핀·KST 출간 활동의 권한별 읽기를 묶는 서비스. */
@Service
class ContentFeedService(private val feeds: ContentFeedRepository, private val posts: PostRepository,
    private val categories: CategoryRepository, private val taxonomy: PostTaxonomyMetadata,
    private val chapters: CoursePostRepository, private val state: ContentStateRepository,
    private val projects: ProjectRepository) {
    /** @return 전체에는 프로젝트 문서를 포함하고 Tech/Notes 구획에서는 해당 글만 조회한 최신 또는 핀 페이지. */
    @Transactional(readOnly = true)
    fun feed(section: String, sort: String, page: Int, size: Int, categoryId: Long?, tag: String?,
        authentication: Authentication?): ContentFeedPage {
        validatePage(page, size)
        val selected = when (section.lowercase(Locale.ROOT)) {
            "all" -> null
            "tech" -> PostSection.TECH
            "notes" -> PostSection.NOTE_CHAPTER
            else -> throw InvalidPostRequestException()
        }
        val pinned = when (sort.lowercase(Locale.ROOT)) {
            "new" -> false
            "pin" -> true
            else -> throw InvalidPostRequestException()
        }
        if (categoryId != null && categoryId <= 0) throw InvalidPostRequestException()
        val category = categoryId?.let { categories.findByIdOrNull(it)
            ?: return ContentFeedPage(emptyList(), page, size, 0, 0) }
        val path = category?.path
        val normalizedTag = tag?.takeIf(String::isNotBlank)?.let(TagNames::normalize)
        val result = feeds.feed(PostStatus.PUBLISHED, PostSection.TECH, PostSection.NOTE_CHAPTER,
            PostSection.PROJECT_DOC, selected, PostSection.PROJECT_HOME, PostVisibility.PUBLIC,
            authentication.canReadPrivate(), pinned,
            category?.depth == 3 && !pinned,
            path, path?.let { "$it/%" }, normalizedTag, PageRequest.of(page, size))
        return page(result.content, page, size, result.totalElements, result.totalPages, authentication.canReadPrivate())
    }

    /** @return 제목·본문·태그·분류·과목 정보에 실제 문자열이 있는 공개 글 페이지. */
    @Transactional(readOnly = true)
    fun search(query: String, page: Int, size: Int, authentication: Authentication?): ContentFeedPage {
        validatePage(page, size)
        val normalized = query.trim().lowercase(Locale.ROOT)
        if (normalized.codePointCount(0, normalized.length) !in 1..100 ||
            normalized.any(Character::isISOControl)) throw InvalidPostRequestException()
        val result = feeds.search(PostStatus.PUBLISHED, PostSection.PROJECT_HOME,
            PostSection.PROJECT_DOC, PostVisibility.PUBLIC, authentication.canReadPrivate(),
            normalized, PageRequest.of(page, size))
        return page(result.content, page, size, result.totalElements, result.totalPages, authentication.canReadPrivate())
    }

    /** @return 지정한 최근 개월의 KST 날짜별 출간 수와 활동 일수. */
    @Transactional(readOnly = true)
    fun activity(months: Int, authentication: Authentication?): ActivityResponse {
        if (months !in 1..12) throw InvalidPostRequestException()
        val today = LocalDate.now(SEOUL)
        val first = today.minusMonths(months.toLong()).plusDays(1)
        val from = first.atStartOfDay(SEOUL).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime()
        val counts = feeds.activityDates(PostStatus.PUBLISHED, PostSection.TECH, PostSection.NOTE_CHAPTER,
            PostSection.PROJECT_DOC, PostSection.PROJECT_HOME,
            authentication.canReadPrivate(), PostVisibility.PUBLIC, from)
            .map { it.atZone(ZoneOffset.UTC).withZoneSameInstant(SEOUL).toLocalDate() }
            .filter { !it.isBefore(first) && !it.isAfter(today) }
            .groupingBy { it }.eachCount()
        val items = generateSequence(first) { if (it.isBefore(today)) it.plusDays(1) else null }
            .map { ActivityDayResponse(it, counts[it]?.toLong() ?: 0) }.toList()
        return ActivityResponse(items, counts.values.sum().toLong(), counts.size)
    }

    /** 현재 전체 핀 ID를 본문 없이 조회. */
    @Transactional(readOnly = true)
    fun pins(): PinOrderResponse = PinOrderResponse(posts.findPinnedIds())

    /** [ProjectRepository.findById]의 출간 대문 소속 문서까지 검증해 전체 핀 순열을 저장. */
    @Transactional
    fun replacePins(ids: List<Long>): PinOrderResponse {
        if (ids.size > 1000 || ids.any { it <= 0 } || ids.toSet().size != ids.size)
            throw InvalidPostRequestException()
        state.lockPins() ?: throw IllegalStateException("Missing content state row")
        val current = posts.findPinnedIds()
        val all = (current + ids).distinct().sorted().map { id ->
            posts.findLockedById(id) ?: throw InvalidPostRequestException()
        }
        if (all.filter { it.id in ids }.any { post ->
            post.status != PostStatus.PUBLISHED || post.section !in setOf(
                PostSection.TECH, PostSection.NOTE_CHAPTER, PostSection.PROJECT_DOC) ||
                (post.section == PostSection.PROJECT_DOC && !hasPublishedProjectHome(post.projectId))
        }) throw InvalidPostRequestException()
        all.forEach { it.movePin(null) }
        posts.flush()
        val byId = all.associateBy { it.id }
        ids.forEachIndexed { index, id -> byId.getValue(id).movePin(index + 1) }
        posts.flush()
        return PinOrderResponse(ids)
    }

    /** 프로젝트 문서의 [PostSection.PROJECT_HOME]이 현재 출간 상태인지 확인. */
    private fun hasPublishedProjectHome(projectId: Long?): Boolean {
        val project = projectId?.let(projects::findByIdOrNull) ?: return false
        val home = project.homePostId?.let(posts::findByIdOrNull) ?: return false
        return home.status == PostStatus.PUBLISHED && home.section == PostSection.PROJECT_HOME &&
            home.projectId == project.id
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
                row.pinOrder, row.viewCount, if ((series?.size ?: 0) > 1) seriesPosition else null,
                series?.size?.takeIf { it > 1 }, row.techSeriesOrder)
        }, page, size, total, pages)
    }

    /** SQL 페이지와 오프셋을 제한. */
    private fun validatePage(page: Int, size: Int) {
        if (page < 0 || size !in 1..100 || page.toLong() * size > Int.MAX_VALUE)
            throw InvalidPostRequestException()
    }

    /** @return 실제 USER/ADMIN 역할만 사설 글을 볼 수 있는지 여부. */
    private fun Authentication?.canReadPrivate(): Boolean = this?.authorities?.any {
        it.authority == "ROLE_USER" || it.authority == "ROLE_ADMIN"
    } == true

    private companion object { val SEOUL: ZoneId = ZoneId.of("Asia/Seoul") }
}
