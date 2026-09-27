package io.github.gjaku1031.kenblog.project.service

import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.ContentAddress
import io.github.gjaku1031.kenblog.draft.domain.EditorDraftEntity
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import io.github.gjaku1031.kenblog.post.service.PostService
import io.github.gjaku1031.kenblog.project.domain.InvalidProjectRequestException
import io.github.gjaku1031.kenblog.project.domain.ProjectConflictException
import io.github.gjaku1031.kenblog.project.domain.ProjectEntity
import io.github.gjaku1031.kenblog.project.domain.ProjectMetadata
import io.github.gjaku1031.kenblog.project.domain.ProjectNotFoundException
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminDetailResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminDocumentResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectAdminPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectDetailResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectHomeResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectPublicInfo
import io.github.gjaku1031.kenblog.project.dto.ProjectRelatedPageResponse
import io.github.gjaku1031.kenblog.project.dto.ProjectSummaryResponse
import io.github.gjaku1031.kenblog.project.dto.adminInfo
import io.github.gjaku1031.kenblog.project.dto.ProjectMetadataRequests
import io.github.gjaku1031.kenblog.project.repository.ProjectPostRepository
import io.github.gjaku1031.kenblog.project.repository.ProjectRepository
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService
import java.time.Clock
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.Locale
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.PageRequest
import org.springframework.data.repository.findByIdOrNull
import org.springframework.security.core.Authentication
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 프로젝트 대문·문서·관련 Tech의 부모 권한과 관리자 순서·삭제를 담당.
 *
 * 읽기에서는 HOME 출간과 부모 visibility를 먼저 확인하고, 쓰기에서는 프로젝트 행을
 * 자식 게시글보다 먼저 잠금. OCI 객체는 삭제하지 않으며 글 FK 연결만 함께 제거함.
 */
@Service
class ProjectService(
    private val projects: ProjectRepository,
    private val projectPosts: ProjectPostRepository,
    private val posts: PostRepository,
    private val postService: PostService,
    private val stackBadges: StackBadgeService,
) {
    /** @return HOME이 출간됐고 현재 역할이 읽을 수 있는 프로젝트의 12개 기본 페이지. */
    @Transactional(readOnly = true)
    fun list(page: Int, size: Int, authentication: Authentication?): ProjectPageResponse {
        pageArguments(page, size, 100)
        val privateAllowed = authentication.canReadPrivate()
        val result = projects.findVisible(PostStatus.PUBLISHED, privateAllowed, PostVisibility.PUBLIC,
            PageRequest.of(page, size))
        return ProjectPageResponse(result.content.map { it.summary(privateAllowed) }, page, size,
            result.totalElements, result.totalPages)
    }

    /**
     * 프로젝트 공개 상세를 조회. PRIVATE 부모의 비관리자 응답에는 이름·주소만 남기고
     * 문서·건수·HOME 본문·관련 Tech를 선택하지 않음.
     */
    @Transactional(readOnly = true)
    fun detail(rawSlug: String, authentication: Authentication?): ProjectDetailResponse {
        val project = visibleBase(rawSlug)
        val home = home(project)
        val privateAllowed = authentication.canReadPrivate()
        if (!privateAllowed && (project.visibility != PostVisibility.PUBLIC || home.visibility != PostVisibility.PUBLIC)) {
            return ProjectDetailResponse(true,
                ProjectPublicInfo(null, project.slug, project.name, null, null, null, null, null, null, null),
                null, emptyList(), emptyList(), 0)
        }
        val id = project.id ?: error("Persisted project has no ID")
        val documents = projectPosts.findPublishedDocuments(id, PostSection.PROJECT_DOC, PostStatus.PUBLISHED,
            privateAllowed, PostVisibility.PUBLIC).map { it.response() }
        val related = projectPosts.findRelatedTech(id, PostSection.TECH, PostStatus.PUBLISHED,
            privateAllowed, PostVisibility.PUBLIC, PageRequest.of(0, 5))
        val info = ProjectPublicInfo(id, project.slug, project.name, project.status, project.startPeriod,
            project.endPeriod, project.overview, project.visibility, documents.size.toLong(), related.totalElements,
            stackBadges.listForProject(id))
        return ProjectDetailResponse(false, info,
            ProjectHomeResponse(home.id ?: error("Persisted home has no ID"), home.title, home.slug,
                home.body, home.publishedAt.kstDate(), home.bodySha256),
            documents, related.content.map { it.response() }, related.totalElements)
    }

    /** @return 현재 읽을 수 있는 프로젝트의 관련 TECH 글만 5개 기본 페이지로 조회. */
    @Transactional(readOnly = true)
    fun related(rawSlug: String, page: Int, size: Int, authentication: Authentication?): ProjectRelatedPageResponse {
        pageArguments(page, size, 20)
        val project = visibleBase(rawSlug)
        val home = home(project)
        val privateAllowed = authentication.canReadPrivate()
        if (!privateAllowed && (project.visibility != PostVisibility.PUBLIC || home.visibility != PostVisibility.PUBLIC)) {
            throw ProjectNotFoundException()
        }
        val result = projectPosts.findRelatedTech(project.id ?: error("Persisted project has no ID"),
            PostSection.TECH, PostStatus.PUBLISHED, privateAllowed, PostVisibility.PUBLIC, PageRequest.of(page, size))
        return ProjectRelatedPageResponse(result.content.map { it.response() }, page, size,
            result.totalElements, result.totalPages)
    }

    /** @return 비공개 포함 관리자 프로젝트 목록; 본문 열을 선택하지 않음. */
    @Transactional(readOnly = true)
    fun adminList(page: Int, size: Int): ProjectAdminPageResponse {
        pageArguments(page, size, 100)
        val result = projects.findAdminPage(PageRequest.of(page, size))
        return ProjectAdminPageResponse(result.content.map { it.adminInfo().copy(stackBadges = stackBadges.listForProject(it.id!!)) }, page, size,
            result.totalElements, result.totalPages)
    }

    /** @return 현재 공개 대문과 전체 문서·처음 다섯 관련 Tech의 관리자 상세. */
    @Transactional(readOnly = true)
    fun adminDetail(id: Long): ProjectAdminDetailResponse {
        if (id <= 0) throw InvalidProjectRequestException()
        val project = projects.findByIdOrNull(id) ?: throw ProjectNotFoundException()
        val documents = projectPosts.findAdminDocuments(id, PostSection.PROJECT_DOC)
        val related = projectPosts.findRelatedTech(id, PostSection.TECH, PostStatus.PUBLISHED, true,
            PostVisibility.PUBLIC, PageRequest.of(0, 5)).content.map { it.response() }
        return ProjectAdminDetailResponse(project.adminInfo().copy(stackBadges = stackBadges.listForProject(id)), project.homePostId?.let(postService::adminDetail),
            documents, related)
    }

    /** @return 출간에 사용할 현재 부모 행의 공유 잠금. 없으면 404. */
    @Transactional
    fun sharedParent(id: Long): ProjectEntity {
        if (id <= 0) throw InvalidProjectRequestException()
        return projects.findSharedById(id) ?: throw ProjectNotFoundException()
    }

    /** @return 편집본 출간·프로젝트 순서 변경에 사용할 부모 배타 잠금. */
    @Transactional
    fun lockedParent(id: Long): ProjectEntity {
        if (id <= 0) throw InvalidProjectRequestException()
        return projects.findLockedById(id) ?: throw ProjectNotFoundException()
    }

    /** @return 새 HOME 출간에서 부모 행을 먼저 만들고 글 생성 후 연결할 객체. */
    @Transactional
    fun createProject(draft: EditorDraftEntity, metadata: ProjectMetadata): ProjectEntity = conflicts {
        val normalized = ProjectMetadataRequests.validate(metadata)
        val normalizedName = draft.title.trim()
        val normalizedSlug = ContentAddress.publishDraft(draft.slug, PostSection.PROJECT_HOME)
        if (normalizedName.isBlank() || normalizedName.codePointCount(0, normalizedName.length) > 200)
            throw InvalidProjectRequestException()
        projects.saveAndFlush(ProjectEntity(normalizedSlug, normalizedName, normalized, now())).also {
            stackBadges.replaceProjectStack(it.id!!, normalized.stackBadgeNames)
        }
    }

    /** 새 HOME 글 저장 후 동일 트랜잭션에서 순환 FK를 완성. */
    @Transactional
    fun attachHome(project: ProjectEntity, postId: Long) {
        if (project.homePostId != null || postId <= 0) throw ProjectConflictException()
        project.attachHome(postId)
        projects.saveAndFlush(project)
    }

    /** 기존 HOME 출간의 프로젝트 기준 시각을 확인하고 메타·이름을 교체하며 주소는 유지. */
    @Transactional
    fun updateHome(project: ProjectEntity, post: PostEntity, metadata: ProjectMetadata) = conflicts {
        val projectId = project.id ?: error("Persisted project has no ID")
        if (project.homePostId != post.id || post.projectId != projectId ||
            project.updatedAt != metadata.baseProjectUpdatedAt) throw ProjectConflictException()
        val normalized = ProjectMetadataRequests.validate(metadata)
        project.rename(post.title, now())
        project.replace(normalized, now())
        projects.saveAndFlush(project)
        stackBadges.replaceProjectStack(projectId, normalized.stackBadgeNames)
    }

    /** @return 유효한 기존 부모의 다음 문서 순서; HOME 미출간 부모는 409. */
    @Transactional
    fun nextDocumentOrder(project: ProjectEntity): Int {
        home(project)
        val maximum = projectPosts.maxDocumentOrder(project.id ?: error("Persisted project has no ID"),
            PostSection.PROJECT_DOC) ?: 0
        if (maximum == Int.MAX_VALUE) throw ProjectConflictException()
        return maximum + 1
    }

    /** 전체 DOC 순열을 부모 잠금 아래 확인한 뒤 순서만 바꾸고 원문 수정 시각은 유지. */
    @Transactional
    fun reorderDocuments(id: Long, ids: List<Long>): ProjectAdminDetailResponse = conflicts {
        val project = lockedParent(id)
        val documents = projectPosts.findAdminDocuments(id, PostSection.PROJECT_DOC)
        val actual = documents.map { it.id }
        if (ids.size != actual.size || ids.toSet() != actual.toSet()) throw ProjectConflictException()
        ids.forEachIndexed { index, postId ->
            if (projectPosts.updateDocumentOrder(postId, id, PostSection.PROJECT_DOC, index + 1) != 1)
                throw ProjectConflictException()
        }
        adminDetail(project.id ?: error("Persisted project has no ID"))
    }

    /** 프로젝트의 DOC 한 건을 부모→글 순서로 잠근 뒤 첨부·위키 DB 연결과 함께 삭제. */
    @Transactional
    fun deleteDocument(projectId: Long, postId: Long) = conflicts {
        lockedParent(projectId)
        if (postId <= 0) throw InvalidProjectRequestException()
        val post = projectPosts.findLockedProjectPost(postId, projectId) ?: throw ProjectNotFoundException()
        if (post.section != PostSection.PROJECT_DOC) throw ProjectConflictException()
        projectPosts.delete(post)
        projectPosts.flush()
    }

    /**
     * 부모를 잠그고 HOME 순환 FK를 해제한 후 모든 소속 글을 삭제.
     * 연결된 첨부·위키·편집본 행은 FK CASCADE, OCI 객체는 그대로 추적 가능하게 둠.
     */
    @Transactional
    fun deleteProject(id: Long) = conflicts {
        val project = lockedParent(id)
        project.detachHome()
        projects.saveAndFlush(project)
        projectPosts.deleteAllByIdInBatch(projectPosts.findProjectPostIds(id))
        projects.delete(project)
        projects.flush()
    }

    /** @return 프로젝트와 HOME이 모두 현재 출간된 경우의 부모, 아니면 409. */
    @Transactional(readOnly = true)
    fun requirePublishedParent(id: Long): ProjectEntity {
        val project = projects.findByIdOrNull(id) ?: throw ProjectNotFoundException()
        home(project)
        return project
    }

    /** @return 출간된 HOME 글, 없으면 공개 탐색에서 숨김. */
    private fun home(project: ProjectEntity): PostEntity {
        val id = project.homePostId ?: throw ProjectNotFoundException()
        val post = posts.findByIdOrNull(id) ?: throw ProjectNotFoundException()
        if (post.section != PostSection.PROJECT_HOME || post.projectId != project.id ||
            post.status != PostStatus.PUBLISHED) throw ProjectNotFoundException()
        return post
    }

    /** @return 엄격한 ASCII slug와 일치하는 프로젝트, 없으면 404. */
    private fun visibleBase(rawSlug: String): ProjectEntity {
        val slug = rawSlug.trim().lowercase(Locale.ROOT)
        if (slug.length > 160 || !SLUG.matches(slug)) throw ProjectNotFoundException()
        return projects.findBySlug(slug) ?: throw ProjectNotFoundException()
    }

    /** @return 현재 역할에서 읽을 수 있는 출간 문서·Tech 건수를 가진 카드. */
    private fun ProjectEntity.summary(privateAllowed: Boolean): ProjectSummaryResponse {
        val projectId = id ?: error("Persisted project has no ID")
        val docCount = projectPosts.countPublishedDocuments(projectId, PostSection.PROJECT_DOC,
            PostStatus.PUBLISHED, privateAllowed, PostVisibility.PUBLIC)
        val relatedCount = projectPosts.findRelatedTech(projectId, PostSection.TECH, PostStatus.PUBLISHED,
            privateAllowed, PostVisibility.PUBLIC, PageRequest.of(0, 1)).totalElements
        return ProjectSummaryResponse(projectId, slug, name, status, startPeriod, endPeriod, overview,
            visibility, docCount, relatedCount, stackBadges.listForProject(projectId))
    }

    /** 허용하는 페이지·크기와 SQL 오프셋을 한 번에 확인. */
    private fun pageArguments(page: Int, size: Int, maximum: Int) {
        if (page < 0 || size !in 1..maximum || page.toLong() * size > Int.MAX_VALUE) throw InvalidProjectRequestException()
    }

    /** @return 명시적 관리자 역할만 비공개 내용을 읽을 수 있음. */
    private fun Authentication?.canReadPrivate(): Boolean = this?.authorities?.any {
        it.authority == "ROLE_ADMIN"
    } == true

    /** @return MySQL 중복 이름/주소·FK 삭제 경합을 공개 가능한 409로 변환. */
    private inline fun <T> conflicts(action: () -> T): T = try { action() }
        catch (ex: DataIntegrityViolationException) { throw ProjectConflictException() }

    /** @return DB DATETIME(6) 정밀도의 현재 UTC 시각. */
    private fun now(): LocalDateTime =
        LocalDateTime.ofInstant(Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)

    /** @return 최초 UTC 출간 시각을 KST 날짜로 바꾼 값. */
    private fun LocalDateTime?.kstDate(): LocalDate = (this ?: error("Published home has no time"))
        .atZone(ZoneOffset.UTC).withZoneSameInstant(ZoneId.of("Asia/Seoul")).toLocalDate()

    private companion object { val SLUG = Regex("[a-z0-9]+(?:-[a-z0-9]+)*") }
}
