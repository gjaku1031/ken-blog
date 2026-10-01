package io.github.gjaku1031.kenblog.pages

import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.note.dto.ChapterDetailResponse
import io.github.gjaku1031.kenblog.note.dto.ChapterSummaryResponse
import io.github.gjaku1031.kenblog.note.dto.CourseSummaryResponse
import io.github.gjaku1031.kenblog.note.service.CourseService
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.ContentFeedItem
import io.github.gjaku1031.kenblog.post.dto.PublicPostDetailResponse
import io.github.gjaku1031.kenblog.post.service.ContentFeedService
import io.github.gjaku1031.kenblog.post.service.PublicPostService
import io.github.gjaku1031.kenblog.profile.service.HomeProfileService
import io.github.gjaku1031.kenblog.project.dto.ProjectSummaryResponse
import io.github.gjaku1031.kenblog.project.service.ProjectService
import java.security.MessageDigest
import java.util.HexFormat
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Isolation
import org.springframework.transaction.annotation.Transactional
import tools.jackson.databind.ObjectMapper

/** GitHub Actions가 한 번에 가져갈 공개 메타데이터. 원고 본문은 checkout에서 주입한다. */
@Service
class PagesSnapshotService(
    private val profile: HomeProfileService,
    private val feed: ContentFeedService,
    private val posts: PublicPostService,
    private val projects: ProjectService,
    private val courses: CourseService,
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
) {
    /** 전체 조회와 자산 revision 계산을 같은 MySQL 일관 읽기 안에서 수행. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun snapshot(): Map<String, Any?> {
        val card = profile.get()
        val profileData = linkedMapOf<String, Any?>(
            "name" to card.name, "tagline" to card.tagline, "intro" to card.intro,
            "github" to card.github, "email" to card.email, "photoUrl" to card.photoUrl,
        )

        val techRows = allPages { page -> posts.list(page, PAGE_SIZE, null, null, null).let {
            Batch(it.items, it.totalPages, it.totalElements)
        } }
        val postData = techRows.map { row ->
            posts.detailMetadata(row.slug).also { check(it.id == row.id && it.section == PostSection.TECH) }.snapshot()
        }
        val techById = postData.associateBy { it["id"] as Long }

        val projectRows = allPages { page -> projects.list(page, PAGE_SIZE, null).let {
            Batch(it.items, it.totalPages, it.totalElements)
        } }.filter { it.visibility == PostVisibility.PUBLIC }
        val projectData = projectRows.map { it.snapshot() }
        val projectDetails = linkedMapOf<String, Any?>()
        val projectDocuments = linkedMapOf<String, Any?>()
        val documentPosts = mutableListOf<MutableMap<String, Any?>>()
        val homeIds = mutableSetOf<Long>()
        for (row in projectRows) {
            val detail = projects.detailMetadata(row.slug)
            val home = requireNotNull(detail.home) { "Published project has no home" }
            check(!detail.locked && detail.project.id == row.id)
            homeIds += home.id
            val documents = linkedMapOf<String, Any?>()
            val navigation = mutableListOf<Map<String, Any?>>()
            for (entry in detail.documents) {
                if (entry.visibility != PostVisibility.PUBLIC || entry.locked) continue
                val post = posts.detailMetadata(entry.slug)
                check(post.id == entry.id && post.section == PostSection.PROJECT_DOC && post.projectSlug == row.slug)
                val data = post.snapshot()
                documents[entry.slug] = data
                documentPosts += data
                navigation += linkedMapOf(
                    "id" to entry.id, "title" to entry.title, "slug" to entry.slug,
                    "order" to entry.order, "publishedDate" to entry.publishedDate.toString(),
                    "visibility" to "PUBLIC", "locked" to false,
                )
            }
            projectDocuments[row.slug] = documents
            projectDetails[row.slug] = linkedMapOf(
                "locked" to false,
                "project" to (row.snapshot() + ("homePostId" to home.id)),
                "home" to linkedMapOf("id" to home.id, "title" to home.title, "slug" to home.slug,
                    "body" to "", "publishedDate" to home.publishedDate.toString()),
                "documents" to navigation,
                "relatedTech" to detail.relatedTech.filter { techById[it.id]?.get("slug") == it.slug }.map {
                    linkedMapOf("id" to it.id, "title" to it.title, "slug" to it.slug,
                        "publishedDate" to it.publishedDate.toString())
                },
                "relatedTechCount" to detail.relatedTechCount,
            )
        }

        val noteRows = courses.list(null).items
        val noteData = noteRows.map { it.snapshot() }
        val courseDetails = linkedMapOf<String, Any?>()
        val chapters = linkedMapOf<String, Any?>()
        val chapterPosts = mutableListOf<MutableMap<String, Any?>>()
        for (row in noteRows) {
            val detail = courses.detailMetadata(row.slug)
            check(detail.course.id == row.id)
            val chapterBodies = linkedMapOf<String, Any?>()
            val chapterNavigation = mutableListOf<Map<String, Any?>>()
            for (entry in detail.chapters) {
                if (entry.visibility != PostVisibility.PUBLIC || entry.locked) continue
                val chapter = courses.chapterMetadata(row.slug, entry.slug).chapter
                check(chapter.id == entry.id && !chapter.locked && chapter.body == "")
                val data = chapter.snapshot()
                chapterBodies[entry.slug] = data
                chapterPosts += data
                chapterNavigation += entry.snapshot()
            }
            courseDetails[row.slug] = linkedMapOf("course" to row.snapshot(), "chapters" to chapterNavigation)
            chapters[row.slug] = chapterBodies
        }

        val publicPostIds = (postData + documentPosts + chapterPosts).mapTo(mutableSetOf()) { it["id"] as Long }
        publicPostIds += homeIds
        val publicProjects = projectRows.mapTo(mutableSetOf()) { it.slug }
        val publicCourses = noteRows.mapTo(mutableSetOf()) { it.slug }
        val projectNames = projectRows.associate { it.slug to it.name }
        val feedRows = allPages { page -> feed.feed("all", page, PAGE_SIZE, null, null, null).let {
            Batch(it.items, it.totalPages, it.totalElements)
        } }
        val feedData = feedRows.filter { item ->
            item.visibility == PostVisibility.PUBLIC && when (item.section) {
                PostSection.TECH -> item.id in publicPostIds
                PostSection.PROJECT_HOME -> item.projectSlug != null && item.projectSlug in publicProjects && item.id in homeIds
                PostSection.PROJECT_DOC -> item.projectSlug != null && item.projectSlug in publicProjects && item.id in publicPostIds
                PostSection.NOTE_CHAPTER -> item.courseSlug != null && item.courseSlug in publicCourses && item.id in publicPostIds
            }
        }.map { item ->
            item.snapshot().also { row ->
                if (item.section == PostSection.TECH && (item.projectSlug == null || item.projectSlug !in publicProjects)) {
                    row["projectSlug"] = null
                    row["projectName"] = null
                } else if (item.section == PostSection.TECH && item.projectSlug != null) {
                    row["projectName"] = projectNames[item.projectSlug]
                }
            }
        }

        val payload = linkedMapOf<String, Any?>(
            "version" to 1, "profile" to profileData, "feed" to feedData,
            "projects" to projectData, "notes" to noteData, "posts" to postData,
            "projectDetails" to projectDetails, "projectDocuments" to projectDocuments,
            "courseDetails" to courseDetails, "chapters" to chapters,
        )
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(mapper.writeValueAsBytes(payload))
        digest.update(0)
        publicAttachmentRevisions(publicPostIds).forEach { digest.update(it.toByteArray(Charsets.UTF_8)); digest.update(0) }
        payload["revision"] = HexFormat.of().formatHex(digest.digest())
        return payload
    }

    /** 공개 글에 연결된 자산의 링크·바이트 revision만 해시에 넣고 key는 응답에서 제외. */
    private fun publicAttachmentRevisions(publicPostIds: Set<Long>): List<String> = jdbc.query(
        """SELECT pa.post_id, a.id, a.object_key, a.byte_size, a.content_type, a.status, a.updated_at
           FROM post_attachments pa JOIN posts p ON p.id = pa.post_id
           JOIN attachments a ON a.id = pa.attachment_id
           WHERE p.status = 'PUBLISHED' AND p.visibility = 'PUBLIC'
           ORDER BY pa.post_id, a.id""",
    ) { rs, _ ->
        rs.getLong(1) to listOf(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getLong(4),
            rs.getString(5), rs.getString(6), rs.getTimestamp(7).toInstant().toString()).joinToString("\u0000")
    }.filter { it.first in publicPostIds }.map { it.second }

    private data class Batch<T>(val items: List<T>, val pages: Int, val total: Long)

    private fun <T> allPages(fetch: (Int) -> Batch<T>): List<T> {
        val first = fetch(0)
        check(first.pages in 0..MAX_PAGES && first.total >= 0)
        val rows = first.items.toMutableList()
        for (page in 1 until first.pages) {
            val next = fetch(page)
            check(next.pages == first.pages && next.total == first.total)
            rows += next.items
        }
        check(rows.size.toLong() == first.total) { "Public snapshot page count changed" }
        return rows
    }

    private fun CategoryRefResponse.snapshot(): Map<String, Any?> = linkedMapOf(
        "id" to id, "path" to path, "name" to name, "depth" to depth,
    )

    private fun PublicPostDetailResponse.snapshot(): MutableMap<String, Any?> = linkedMapOf(
        "id" to id, "title" to title, "slug" to slug, "publishedDate" to publishedDate.toString(),
        "section" to section.name, "projectSlug" to projectSlug, "courseSlug" to courseSlug,
        "category" to category?.snapshot(), "tags" to tags, "summary" to summary,
        "chapterOrder" to null, "locked" to false, "body" to "", "documentOrder" to null,
        "relatedProject" to relatedProject?.let { linkedMapOf("id" to it.id, "slug" to it.slug, "name" to it.name) },
        "series" to series?.let { linkedMapOf("items" to it.items.map { row ->
            linkedMapOf("id" to row.id, "slug" to row.slug, "title" to row.title, "order" to row.order)
        }, "position" to it.position) },
    )

    private fun ProjectSummaryResponse.snapshot(): Map<String, Any?> = linkedMapOf(
        "id" to id, "slug" to slug, "name" to name, "status" to status.name,
        "startPeriod" to startPeriod, "endPeriod" to endPeriod, "overview" to overview,
        "visibility" to "PUBLIC", "sortOrder" to sortOrder,
        "documentCount" to documentCount, "relatedTechCount" to relatedTechCount,
        "stackBadges" to stackBadges.map { badge -> linkedMapOf("id" to badge.id, "name" to badge.name,
            "imageUrl" to badge.imageUrl, "projectCount" to badge.projectCount) },
    )

    private fun CourseSummaryResponse.snapshot(): Map<String, Any?> = linkedMapOf(
        "id" to id, "slug" to slug, "field" to field, "name" to name,
        "description" to description, "status" to status.name, "chapterCount" to chapterCount,
        "latestPublishedDate" to latestPublishedDate?.toString(),
    )

    private fun ChapterSummaryResponse.snapshot(): Map<String, Any?> = linkedMapOf(
        "id" to id, "slug" to slug, "title" to title, "position" to position,
        "publishedDate" to publishedDate.toString(), "visibility" to "PUBLIC", "locked" to false,
        "summary" to summary,
    )

    private fun ChapterDetailResponse.snapshot(): MutableMap<String, Any?> = linkedMapOf(
        "id" to id, "title" to title, "slug" to slug, "publishedDate" to publishedDate.toString(),
        "section" to "NOTE_CHAPTER", "projectSlug" to null, "courseSlug" to courseSlug,
        "category" to null, "tags" to emptyList<String>(), "summary" to null,
        "chapterOrder" to null, "locked" to false, "body" to "", "documentOrder" to null,
        "relatedProject" to null, "series" to null,
    )

    private fun ContentFeedItem.snapshot(): MutableMap<String, Any?> = linkedMapOf(
        "id" to id, "title" to title, "slug" to slug, "section" to section.name,
        "projectSlug" to projectSlug, "courseSlug" to courseSlug, "summary" to summary,
        "publishedDate" to publishedDate.toString(), "visibility" to "PUBLIC",
        "category" to category?.snapshot(), "tags" to tags,
        "projectName" to projectName, "courseName" to courseName, "courseField" to courseField,
        "chapterPosition" to chapterPosition, "chapterTotal" to chapterTotal,
        "seriesPosition" to seriesPosition, "seriesTotal" to seriesTotal,
    )

    private companion object {
        const val PAGE_SIZE = 100
        const val MAX_PAGES = 10_000
    }
}
