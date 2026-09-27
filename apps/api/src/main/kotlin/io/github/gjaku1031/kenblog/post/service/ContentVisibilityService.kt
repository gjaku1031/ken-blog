package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.note.domain.CourseConflictException
import io.github.gjaku1031.kenblog.note.repository.CourseRepository
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import io.github.gjaku1031.kenblog.project.domain.ProjectConflictException
import io.github.gjaku1031.kenblog.project.repository.ProjectRepository
import java.time.Clock
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import org.springframework.data.repository.findByIdOrNull
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** [PostSection]별 부모 잠금과 출간 상태를 검증해 관리자 공개 범위를 변경. */
@Service
class ContentVisibilityService(private val posts: PostRepository, private val projects: ProjectRepository,
    private val courses: CourseRepository, private val postService: PostService, private val cache: PostBodyCache) {
    /**
     * TECH는 기존 [PostService.changeVisibilityDetail]을 사용하고 HOME은 프로젝트와 함께 공개 범위를 변경.
     * DOC·NOTE는 부모를 먼저 잠근 뒤 현재 소속과 출간 상태를 재확인해 [PostDetailResponse]를 반환.
     */
    @Transactional
    fun change(id: Long, visibility: PostVisibility): PostDetailResponse {
        if (id <= 0) throw InvalidPostRequestException()
        val hint = posts.findByIdOrNull(id) ?: throw PostNotFoundException()
        if (hint.section == PostSection.TECH) return postService.changeVisibilityDetail(id, visibility)

        val project = hint.projectId?.let { projects.findLockedById(it) ?: throw ProjectConflictException() }
        if (hint.section == PostSection.NOTE_CHAPTER) {
            hint.courseId?.let { courses.findLockedById(it) ?: throw CourseConflictException() }
                ?: throw CourseConflictException()
        }
        val post = posts.findLockedById(id) ?: throw PostNotFoundException()
        if (post.section != hint.section || post.projectId != hint.projectId || post.courseId != hint.courseId)
            throw ProjectConflictException()
        if (post.status != PostStatus.PUBLISHED) {
            if (post.section == PostSection.NOTE_CHAPTER) throw CourseConflictException()
            throw ProjectConflictException()
        }

        when (post.section) {
            PostSection.PROJECT_HOME, PostSection.PROJECT_DOC -> {
                val parent = project ?: throw ProjectConflictException()
                val homeId = parent.homePostId ?: throw ProjectConflictException()
                val home = if (homeId == id) post else posts.findByIdOrNull(homeId)
                    ?: throw ProjectConflictException()
                if (home.section != PostSection.PROJECT_HOME || home.projectId != parent.id ||
                    home.status != PostStatus.PUBLISHED ||
                    (post.section == PostSection.PROJECT_HOME && homeId != id)) throw ProjectConflictException()
                if (post.section == PostSection.PROJECT_HOME) {
                    parent.changeVisibility(visibility, now())
                    projects.saveAndFlush(parent)
                }
            }
            PostSection.NOTE_CHAPTER -> if (project != null || post.courseId == null)
                throw CourseConflictException()
            PostSection.TECH -> throw ProjectConflictException()
        }
        val previousHash = post.bodySha256
        post.changeVisibility(visibility, now())
        posts.saveAndFlush(post)
        cache.evictAfterCommit(id, previousHash)
        return postService.adminDetail(id)
    }

    /** @return [PostService]와 같은 MySQL DATETIME(6) UTC 시각. */
    private fun now(): LocalDateTime = LocalDateTime.ofInstant(
        Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)
}
