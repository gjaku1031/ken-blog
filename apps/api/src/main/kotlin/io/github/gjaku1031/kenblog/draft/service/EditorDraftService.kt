package io.github.gjaku1031.kenblog.draft.service

import io.github.gjaku1031.kenblog.attachment.service.AttachmentLinkService
import io.github.gjaku1031.kenblog.category.domain.CategoryNotFoundException
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.draft.domain.EditorDraftConflictException
import io.github.gjaku1031.kenblog.draft.domain.EditorDraftEntity
import io.github.gjaku1031.kenblog.draft.domain.EditorDraftNotFoundException
import io.github.gjaku1031.kenblog.draft.domain.InvalidEditorDraftRequestException
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftCreateRequest
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftDetailResponse
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftLockHint
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftPageResponse
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftUpdateRequest
import io.github.gjaku1031.kenblog.draft.dto.response
import io.github.gjaku1031.kenblog.draft.repository.EditorDraftRepository
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import io.github.gjaku1031.kenblog.post.service.PostService
import io.github.gjaku1031.kenblog.post.service.WikiLinkMetadata
import io.github.gjaku1031.kenblog.project.domain.ProjectConflictException
import io.github.gjaku1031.kenblog.project.service.ProjectService
import io.github.gjaku1031.kenblog.note.domain.CourseConflictException
import io.github.gjaku1031.kenblog.note.service.CourseService
import java.time.Clock
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.PessimisticLockingFailureException
import org.springframework.data.domain.PageRequest
import org.springframework.data.repository.findByIdOrNull
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 공개 원문과 편집본의 독립 저장 및 원자적 출간을 담당하는 관리자 서비스.
 *
 * 쓰기에서 필요한 경우 분류 공유 잠금→원본 배타 잠금→편집본 배타 잠금 순서를 유지.
 * [PostService]의 엄격한 원문 검증·flush·커밋 후 캐시 무효화를 같은 트랜잭션에 참여시킴.
 */
@Service
class EditorDraftService(
    private val drafts: EditorDraftRepository,
    private val posts: PostRepository,
    private val categories: CategoryRepository,
    private val postService: PostService,
    private val attachmentLinks: AttachmentLinkService,
    private val wikiLinks: WikiLinkMetadata,
    private val projects: ProjectService,
    private val courses: CourseService,
) {
    /**
     * 빈 제목·미완성 slug를 허용한 독립 편집본을 생성.
     * 기존 글이면 현재 원본 시각과 단일 편집본 제약을 잠금·DB 고유키로 확인.
     *
     * @return revision 0인 저장 결과
     * @throws EditorDraftConflictException 원본이 바뀌었거나 이미 편집본이 있을 때
     * @throws CategoryNotFoundException 지정한 분류가 이미 없을 때
     */
    @Transactional
    fun create(request: EditorDraftCreateRequest): EditorDraftDetailResponse = conflicts {
        val section = request.section ?: request.postId?.let { posts.findByIdOrNull(it)?.section } ?: PostSection.TECH
        validateSection(section, request.categoryId, request.tags, request.projectId,
            request.relatedProjectId, request.projectMetadata, request.courseId, request.postId, request.techSeriesOrder)
        if (section == PostSection.TECH || section == PostSection.PROJECT_DOC)
            lockCategory(request.categoryId, request.techSeriesOrder)
        val parent = request.projectId?.let(projects::sharedParent)
        request.courseId?.let(courses::sharedParent)
        if (section == PostSection.PROJECT_DOC && parent != null) projects.requirePublishedParent(parent.id!!)
        if (section == PostSection.TECH && request.relatedProjectId != null) projects.requirePublishedParent(request.relatedProjectId)
        var inheritedIds: List<Long> = emptyList()
        var inheritedWiki: List<String> = emptyList()
        if (request.postId != null) {
            val original = posts.findLockedById(request.postId) ?: throw PostNotFoundException()
            if (original.section != section || original.projectId != request.projectId ||
                original.courseId != request.courseId) {
                throw EditorDraftConflictException()
            }
            if (original.updatedAt != request.baseUpdatedAt || drafts.findLockedByPostId(request.postId) != null) {
                throw EditorDraftConflictException()
            }
            if (request.attachmentIds == null) inheritedIds = attachmentLinks.postIds(request.postId)
            if (request.wikiTargets == null && request.body == original.body) inheritedWiki = wikiLinks.postTitles(request.postId)
        }
        val draft = drafts.saveAndFlush(EditorDraftEntity(request.postId, request.baseUpdatedAt, request.values(section), now()))
        val draftId = draft.id ?: error("Persisted editor draft has no ID")
        attachmentLinks.replaceDraft(draftId, request.attachmentIds ?: inheritedIds)
        wikiLinks.replaceDraft(draftId, request.wikiTargets ?: inheritedWiki)
        draft.response(attachmentLinks.draftIds(draftId), wikiLinks.currentDraftTitles(draftId))
    }

    /**
     * 본문을 선택하지 않는 한 페이지를 저장 시각·ID 내림차순으로 조회.
     *
     * @param page 0 이상 페이지
     * @param size 1~100 한 페이지 크기
     * @param postId 선택한 양수 원본 ID, 없으면 모든 편집본
     * @return 원본 여부와 revision을 포함한 본문 없는 페이지
     */
    @Transactional(readOnly = true)
    fun list(page: Int, size: Int, postId: Long?): EditorDraftPageResponse {
        if (page < 0 || size !in 1..100 || page.toLong() * size > Int.MAX_VALUE || (postId != null && postId <= 0)) {
            throw InvalidEditorDraftRequestException()
        }
        val result = drafts.findSummaries(postId, PageRequest.of(page, size))
        return EditorDraftPageResponse(result.content.map { it.response() }, page, size,
            result.totalElements, result.totalPages)
    }

    /** @return 양수 ID의 편집본 원문과 저장 revision, 없으면 404. */
    @Transactional(readOnly = true)
    fun detail(id: Long): EditorDraftDetailResponse {
        validId(id)
        return (drafts.findByIdOrNull(id) ?: throw EditorDraftNotFoundException()).response(
            attachmentLinks.draftIds(id), wikiLinks.draftTitles(id))
    }

    /**
     * 원본 ID·기준 시각은 보존하고 내용 전체를 현재 revision에서만 교체.
     * 원본 글의 변경 여부는 실제 출간 시 다시 확인함.
     *
     * @return revision을 하나 높인 편집본 상세
     * @throws EditorDraftConflictException 오래된 revision 또는 동시 경합
     */
    @Transactional
    fun update(id: Long, request: EditorDraftUpdateRequest): EditorDraftDetailResponse = conflicts {
        validId(id)
        val snapshot = preview(id)
        if (request.section != null && request.section != drafts.findByIdOrNull(id)?.section) throw EditorDraftConflictException()
        val section = drafts.findByIdOrNull(id)?.section ?: throw EditorDraftNotFoundException()
        validateSection(section, request.categoryId, request.tags, request.projectId,
            request.relatedProjectId, request.projectMetadata, request.courseId, snapshot.postId, request.techSeriesOrder)
        if (section == PostSection.TECH || section == PostSection.PROJECT_DOC)
            lockCategory(request.categoryId, request.techSeriesOrder)
        if (snapshot.projectId != null) projects.sharedParent(snapshot.projectId)
        if (snapshot.courseId != null) courses.sharedParent(snapshot.courseId)
        val draft = lockDraftAfterPost(id)
        if (draft.projectId != request.projectId || draft.courseId != request.courseId ||
            draft.section != section) throw EditorDraftConflictException()
        if (draft.revision != request.revision) throw EditorDraftConflictException()
        val previousBody = draft.body
        draft.replace(request.values(section), now())
        drafts.saveAndFlush(draft)
        if (request.attachmentIds != null) attachmentLinks.replaceDraft(id, request.attachmentIds)
        if (request.wikiTargets != null || previousBody != request.body) wikiLinks.replaceDraft(id, request.wikiTargets ?: emptyList())
        draft.response(attachmentLinks.currentDraftIds(id), wikiLinks.currentDraftTitles(id))
    }

    /**
     * 현재 revision이 일치할 때 편집본만 삭제하고 공개 원문은 유지.
     *
     * @throws EditorDraftNotFoundException 이미 편집본이 없을 때
     * @throws EditorDraftConflictException 오래된 revision 또는 동시 경합
     */
    @Transactional
    fun delete(id: Long, revision: Long) = conflicts {
        validRevision(revision)
        val draft = lockDraftAfterPost(id)
        if (draft.revision != revision) throw EditorDraftConflictException()
        drafts.delete(draft)
        drafts.flush()
    }

    /**
     * 저장된 원고를 엄격 검증한 후 원본 내용·분류·태그·범위와 편집본 제거를 원자적으로 확정.
     * 원본이 바뀌었거나 분류가 삭제됐으면 아무 변경 없이 롤백함.
     *
     * @return 편집본 제거와 함께 커밋될 [PostDetailResponse]
     * @throws EditorDraftConflictException 오래된 revision·원본 시각 또는 동시 경합
     * @throws CategoryNotFoundException 삭제된 분류 스냅샷일 때
     */
    @Transactional
    fun publish(id: Long, revision: Long): PostDetailResponse = conflicts {
        validRevision(revision)
        val snapshot = preview(id)
        val section = drafts.findByIdOrNull(id)?.section ?: throw EditorDraftNotFoundException()
        if (section == PostSection.TECH || section == PostSection.PROJECT_DOC)
            lockCategory(snapshot.categoryId, snapshot.techSeriesOrder)
        val parent = snapshot.projectId?.let(projects::lockedParent)
        val course = snapshot.courseId?.let(courses::lockedParent)
        val original = snapshot.postId?.let { posts.findLockedById(it) ?: throw EditorDraftNotFoundException() }
        val draft = drafts.findLockedById(id) ?: throw EditorDraftNotFoundException()
        if (draft.revision != revision || draft.postId != snapshot.postId || draft.categoryId != snapshot.categoryId) {
            throw EditorDraftConflictException()
        }
        if (original != null && original.updatedAt != draft.baseUpdatedAt) throw EditorDraftConflictException()
        if (draft.section != section || draft.projectId != snapshot.projectId || draft.courseId != snapshot.courseId ||
            original != null && (original.section != section || original.projectId != draft.projectId ||
                original.courseId != draft.courseId)) throw EditorDraftConflictException()

        val post = when (section) {
            PostSection.TECH -> {
                if (draft.relatedProjectId != null) projects.requirePublishedParent(draft.relatedProjectId!!)
                if (original == null) postService.createDraft(draft.title, draft.slug, draft.body)
                else postService.updateDraft(original.id!!, draft.title, draft.slug, draft.body)
            }
            PostSection.PROJECT_HOME -> {
                val metadata = draft.projectMetadata() ?: throw ProjectConflictException()
                if (original == null) {
                    if (parent != null || metadata.baseProjectUpdatedAt != null) throw ProjectConflictException()
                    val created = projects.createProject(draft.title, draft.slug, metadata)
                    val home = postService.createProjectPost(draft.title, draft.slug, draft.body,
                        section, created.id!!, null)
                    projects.attachHome(created, home.id!!)
                    home
                } else {
                    if (parent == null || parent.homePostId != original.id) throw ProjectConflictException()
                    val home = postService.updateProjectPost(original.id!!, draft.title, draft.slug,
                        draft.body, section, parent.id!!)
                    projects.updateHome(parent, home, metadata)
                    home
                }
            }
            PostSection.PROJECT_DOC -> {
                if (parent == null) throw ProjectConflictException()
                projects.requirePublishedParent(parent.id!!)
                if (original == null) postService.createProjectPost(draft.title, draft.slug, draft.body,
                    section, parent.id!!, projects.nextDocumentOrder(parent))
                else postService.updateProjectPost(original.id!!, draft.title, draft.slug,
                    draft.body, section, parent.id!!)
            }
            PostSection.NOTE_CHAPTER -> {
                if (course == null) throw CourseConflictException()
                if (original == null) postService.createChapterPost(draft.title, draft.slug, draft.body,
                    course.id!!, courses.nextChapterOrder(course.id!!))
                else postService.updateChapterPost(original.id!!, draft.title, draft.slug,
                    draft.body, course.id!!)
            }
        }
        val postId = post.id ?: error("Persisted post has no ID")
        if (section != PostSection.PROJECT_HOME) postService.replaceSummary(postId, draft.summary)
        if (section == PostSection.TECH || section == PostSection.PROJECT_DOC)
            postService.replaceTaxonomy(postId, draft.categoryId, draft.tags())
        if (section == PostSection.TECH) {
            postService.setTechSeriesOrder(postId, draft.techSeriesOrder)
            postService.relateTechPost(postId, draft.relatedProjectId)
        }
        attachmentLinks.publishDraft(postId, id)
        wikiLinks.publishDraft(postId, id)
        if (section == PostSection.TECH) postService.publish(postId, draft.visibility)
        else if (section == PostSection.NOTE_CHAPTER) postService.publishChapterPost(postId, draft.visibility)
        else postService.publishProjectPost(postId, draft.visibility)
        drafts.delete(draft)
        drafts.flush()
        postService.adminDetail(postId)
    }

    /** @return [EditorDraftEntity.techSeriesOrder]가 3단계 TECH 분류에만 속하도록 공유 잠금으로 검증. */
    private fun lockCategory(categoryId: Long?, techSeriesOrder: Int?) {
        if (categoryId == null) {
            if (techSeriesOrder != null) throw InvalidEditorDraftRequestException()
            return
        }
        if (categoryId <= 0) throw InvalidEditorDraftRequestException()
        val category = categories.findSharedById(categoryId) ?: throw CategoryNotFoundException()
        if (techSeriesOrder != null && (techSeriesOrder <= 0 || category.depth != 3))
            throw InvalidEditorDraftRequestException()
    }

    /** [EditorDraftEntity.section]별 소속과 taxonomy를 검증해 우회 출간을 차단. */
    private fun validateSection(section: PostSection, categoryId: Long?, tags: List<String>, projectId: Long?,
        relatedProjectId: Long?, metadata: io.github.gjaku1031.kenblog.project.domain.ProjectMetadata?,
        courseId: Long?, postId: Long?, techSeriesOrder: Int?) {
        when (section) {
            PostSection.TECH -> if (projectId != null || courseId != null || metadata != null)
                throw InvalidEditorDraftRequestException()
            PostSection.PROJECT_HOME -> if (categoryId != null || tags.isNotEmpty() || relatedProjectId != null ||
                techSeriesOrder != null ||
                courseId != null || (postId == null) != (projectId == null) || metadata == null)
                throw InvalidEditorDraftRequestException()
            PostSection.PROJECT_DOC -> if (relatedProjectId != null || techSeriesOrder != null ||
                projectId == null || courseId != null || metadata != null) throw InvalidEditorDraftRequestException()
            PostSection.NOTE_CHAPTER -> if (categoryId != null || tags.isNotEmpty() || projectId != null ||
                techSeriesOrder != null ||
                relatedProjectId != null || metadata != null || courseId == null) throw InvalidEditorDraftRequestException()
        }
    }

    /** @return 잠금 순서 결정을 위한 원본·분류 ID의 현재 편집본 미잠금 사본. */
    private fun preview(id: Long): EditorDraftLockHint {
        validId(id)
        return drafts.findLockHintById(id) ?: throw EditorDraftNotFoundException()
    }

    /** @return 원본을 먼저 잠그고 그 뒤 편집본을 잠근 현재 행. */
    private fun lockDraftAfterPost(id: Long): EditorDraftEntity {
        val snapshot = preview(id)
        if (snapshot.postId != null && posts.findLockedById(snapshot.postId!!) == null) {
            throw EditorDraftNotFoundException()
        }
        val draft = drafts.findLockedById(id) ?: throw EditorDraftNotFoundException()
        if (draft.postId != snapshot.postId) throw EditorDraftConflictException()
        return draft
    }

    /** 양수 자원 ID가 아니면 HTTP 400용 입력 오류를 던짐. */
    private fun validId(id: Long) { if (id <= 0) throw InvalidEditorDraftRequestException() }

    /** revision은 0 이상의 정수만 허용. */
    private fun validRevision(revision: Long) { if (revision < 0) throw InvalidEditorDraftRequestException() }

    /** @return SQL 동기화·잠금 실패를 내부 원인 노출 없는 409로 변환한 실행 결과. */
    private inline fun <T> conflicts(action: () -> T): T = try { action() }
        catch (ex: DataIntegrityViolationException) { throw EditorDraftConflictException() }
        catch (ex: PessimisticLockingFailureException) { throw EditorDraftConflictException() }

    /** @return DB DATETIME(6)에 맞춘 UTC 마이크로초 시각. */
    private fun now(): LocalDateTime =
        LocalDateTime.ofInstant(Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)
}
