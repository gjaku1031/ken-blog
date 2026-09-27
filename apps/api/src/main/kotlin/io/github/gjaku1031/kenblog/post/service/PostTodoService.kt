package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.note.domain.CourseConflictException
import io.github.gjaku1031.kenblog.note.repository.CourseRepository
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostTodoConflictException
import io.github.gjaku1031.kenblog.post.dto.PostTodoRequest
import io.github.gjaku1031.kenblog.post.dto.PostTodoResponse
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

/** 읽기 화면 체크박스의 실제 원문 줄을 검증해 한 글만 원자적으로 변경. */
@Service
class PostTodoService(private val posts: PostRepository, private val projects: ProjectRepository,
    private val courses: CourseRepository, private val cache: PostBodyCache) {
    /** @return 본문 SHA가 일치하고 코드 펜스 밖의 할 일 마커를 변경한 원문. */
    @Transactional
    fun toggle(id: Long, request: PostTodoRequest): PostTodoResponse {
        if (id <= 0) throw InvalidPostRequestException()
        val hint = posts.findByIdOrNull(id) ?: throw PostNotFoundException()
        val parent = hint.projectId?.let { projects.findLockedById(it) ?: throw ProjectConflictException() }
        hint.courseId?.let { courses.findLockedById(it) ?: throw CourseConflictException() }
        val post = posts.findLockedById(id) ?: throw PostNotFoundException()
        if (post.section != hint.section || post.projectId != hint.projectId || post.courseId != hint.courseId)
            throw PostTodoConflictException()
        if (post.status != PostStatus.PUBLISHED) throw PostNotFoundException()
        if (parent != null) {
            val home = parent.homePostId?.let(posts::findByIdOrNull) ?: throw ProjectConflictException()
            if (home.section != PostSection.PROJECT_HOME || home.projectId != parent.id ||
                home.status != PostStatus.PUBLISHED) throw ProjectConflictException()
        }
        if (post.bodySha256 != request.expectedBodySha256) throw PostTodoConflictException()
        val lines = post.body.split('\n').toMutableList()
        if (request.line > lines.size) throw InvalidPostRequestException()
        var fence: Char? = null
        var fenceLength = 0
        for (index in 0 until request.line) {
            val raw = lines[index]
            val marker = FENCE.matchEntire(raw)
            if (marker != null) {
                val run = marker.groupValues[1]
                val trailing = marker.groupValues[2]
                if (fence == null) {
                    fence = run.first()
                    fenceLength = run.length
                } else if (run.first() == fence && run.length >= fenceLength && trailing.isBlank()) {
                    fence = null
                    fenceLength = 0
                }
                if (index == request.line - 1) throw InvalidPostRequestException()
            }
        }
        if (fence != null) throw InvalidPostRequestException()
        val old = lines[request.line - 1]
        val match = TASK.matchEntire(old) ?: throw InvalidPostRequestException()
        val replacement = if (request.done) "x" else " "
        if (match.groupValues[2] == replacement || request.done && match.groupValues[2] == "X")
            return PostTodoResponse(post.body, post.bodySha256)
        lines[request.line - 1] = match.groupValues[1] + replacement + match.groupValues[3]
        val changed = lines.joinToString("\n")
        val oldHash = post.bodySha256
        post.replaceDraft(post.title, changed, now())
        posts.saveAndFlush(post)
        cache.evictAfterCommit(id, oldHash)
        return PostTodoResponse(post.body, post.bodySha256)
    }

    /** @return MySQL DATETIME(6)에 맞춘 UTC 시각. */
    private fun now(): LocalDateTime = LocalDateTime.ofInstant(
        Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)

    private companion object {
        val TASK = Regex("^(\\s*(?:[-*+]|[0-9]+[.)])\\s+\\[)([ xX])(\\].*)$")
        val FENCE = Regex("^ {0,3}(`{3,}|~{3,})(.*)$")
    }
}
