package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.PostViewAccessRow
import io.github.gjaku1031.kenblog.post.dto.PostViewResponse
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import jakarta.servlet.http.HttpServletRequest
import java.time.Clock
import org.springframework.security.core.Authentication
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 공개 글 권한을 본문 없이 재확인하고 세션당 짧은 재조회·관리자·봇을 집계에서 제외. */
@Service
class PostViewService(private val posts: PostRepository) {
    /** @return 읽기 권한이 있는 출간 글의 현재 저장 조회 수. */
    @Transactional
    fun record(id: Long, authentication: Authentication?, request: HttpServletRequest): PostViewResponse {
        if (id <= 0) throw PostNotFoundException()
        val access = posts.findViewAccess(id) ?: throw PostNotFoundException()
        if (!access.readable(authentication.canReadPrivate())) throw PostNotFoundException()
        val current = posts.findViewCount(id) ?: throw PostNotFoundException()
        if (authentication.isAdmin() || request.getHeader("User-Agent")?.contains(BOT, ignoreCase = true) == true)
            return PostViewResponse(current)
        val session = request.getSession(true)
        val key = "kenblog:view:$id"
        val now = Clock.systemUTC().millis()
        val previous = session.getAttribute(key) as? Long
        if (previous != null && now - previous < DEDUP_MILLIS) return PostViewResponse(current)
        posts.incrementViewCount(id)
        session.setAttribute(key, now)
        return PostViewResponse(posts.findViewCount(id) ?: current + 1)
    }

    /** @return 글·부모 대문의 현재 출간·열람 범위를 모두 통과하는지 여부. */
    private fun PostViewAccessRow.readable(includePrivate: Boolean): Boolean =
        status == PostStatus.PUBLISHED && (includePrivate || visibility == PostVisibility.PUBLIC) &&
            (section !in setOf(PostSection.PROJECT_HOME, PostSection.PROJECT_DOC) ||
                (homeId != null && homeProjectId == projectId && homeSection == PostSection.PROJECT_HOME &&
                    homeStatus == PostStatus.PUBLISHED &&
                    (section != PostSection.PROJECT_HOME || id == homeId) &&
                    (includePrivate || projectVisibility == PostVisibility.PUBLIC &&
                        homeVisibility == PostVisibility.PUBLIC)))

    /** @return 로그인한 관리자인지 여부. */
    private fun Authentication?.isAdmin(): Boolean = this?.authorities?.any { it.authority == "ROLE_ADMIN" } == true

    /** @return 명시적 관리자만 비공개 글을 열람할 수 있는지 여부. */
    private fun Authentication?.canReadPrivate(): Boolean = this?.authorities?.any {
        it.authority == "ROLE_ADMIN"
    } == true

    private companion object {
        const val DEDUP_MILLIS = 60L * 60 * 1000
        const val BOT = "bot"
    }
}
