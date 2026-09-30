package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.deployment.ContentMutation
import io.github.gjaku1031.kenblog.deployment.PublicationChange

import io.github.gjaku1031.kenblog.attachment.service.AttachmentLinkService
import io.github.gjaku1031.kenblog.content.service.RepositoryMarkdown
import io.github.gjaku1031.kenblog.category.domain.CategoryConflictException
import io.github.gjaku1031.kenblog.category.domain.CategoryNotFoundException
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.draft.service.EditorDraftService
import io.github.gjaku1031.kenblog.draft.domain.EditorDraftEntity
import io.github.gjaku1031.kenblog.post.domain.ContentAddress
import io.github.gjaku1031.kenblog.post.domain.DuplicatePostSlugException
import io.github.gjaku1031.kenblog.post.domain.InvalidPostDraftException
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostBodyHash
import io.github.gjaku1031.kenblog.post.domain.PostSummaryText
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.PostTagEntity
import io.github.gjaku1031.kenblog.post.domain.TagNames
import io.github.gjaku1031.kenblog.post.domain.WikiLinkConflictException
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PostPageResponse
import io.github.gjaku1031.kenblog.post.dto.PostSummaryResponse
import io.github.gjaku1031.kenblog.post.dto.TagCountResponse
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import io.github.gjaku1031.kenblog.post.repository.PostTagRepository
import io.github.gjaku1031.kenblog.project.domain.ProjectConflictException
import io.github.gjaku1031.kenblog.project.repository.ProjectRepository
import io.github.gjaku1031.kenblog.note.repository.CourseRepository
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService
import java.sql.SQLIntegrityConstraintViolationException
import java.time.Clock
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.Locale
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.PessimisticLockingFailureException
import org.springframework.data.domain.PageRequest
import org.springframework.data.repository.findByIdOrNull
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 게시글 입력 계약과 [PostRepository]의 생성·목록·수정·삭제·출간 상태 전환을 트랜잭션으로 묶는 서비스.
 *
 * 생성에는 새 [PostEntity]의 null ID와 저장 결과를 사용하며, 조회에는
 * [findByIdOrNull]과 저장소의 파생 쿼리를 사용함.
 *
 * 관리자 HTTP 경로는 [io.github.gjaku1031.kenblog.post.controller.PostController]가 담당하며,
 * 기존 [createDraft]·[findById]·[findBySlug] 내부 호출 계약을 유지함.
 *
 * @property repository 게시글 영속 저장소
 */
@Service
class PostService(
    private val repository: PostRepository,
    private val categories: CategoryRepository,
    private val tags: PostTagRepository,
    private val taxonomy: PostTaxonomyMetadata,
    private val attachmentLinks: AttachmentLinkService,
    private val wikiLinks: WikiLinkMetadata,
    private val projects: ProjectRepository,
    private val courses: CourseRepository,
    private val stackBadges: StackBadgeService,
    private val markdown: RepositoryMarkdown,
) {
    /**
     * 제목을 검증하고 주소를 서버에서 발급한 후 초안을 원자적으로 저장.
     *
     * 제목은 Unicode 코드 포인트 1~200자, 본문은 UTF-8 1 MiB 이하. DB의 고유 제약이
     * 동시 저장 경쟁을 최종 판정함.
     * [PostRepository.saveAndFlush]는 SQL을 동기화하지만 트랜잭션을 커밋하지 않음.
     * 이 호출 중 MySQL `uk_posts_slug` 중복 오류만 도메인 예외로 변환함.
     *
     * @param title 앞뒤 공백을 제거할 제목
     * @param body 원문 그대로 저장할 초안 본문
     * @return ID와 생성·수정 시각이 채워진 [PostEntity]
     * @throws InvalidPostDraftException 입력 계약을 충족하지 않을 때
     * @throws DuplicatePostSlugException 고유 slug 제약과 충돌할 때
     * @throws DataIntegrityViolationException 다른 저장 제약 오류가 발생할 때
     */
    @Transactional
    @ContentMutation
    fun createDraft(title: String, body: String): PostEntity =
        createTechDraft(title, body, ContentAddress.create(PostSection.TECH))

    /** @return [EditorDraftEntity]의 자동 주소를 유지하며 새 TECH 원본 생성. */
    @Transactional
    @ContentMutation
    fun createDraftFromEditor(draft: EditorDraftEntity, body: String = draft.body): PostEntity =
        createTechDraft(draft.title, body, ContentAddress.publishDraft(draft.slug, PostSection.TECH))

    /** @return 서버에서 발급하거나 저장한 편집본에서 승계한 주소로 생성한 TECH 원본. */
    private fun createTechDraft(title: String, body: String, slug: String): PostEntity {
        val values = validateDraft(title, body)
        val post = PostEntity(values.title, slug, values.body, now())
        post.replaceSummary(PostSummaryText.fromBody(values.body))
        return saveDraft(post, slug)
    }

    /**
     * 본문을 선택하지 않는 고정 정렬의 관리자 초안·출간 목록을 조회.
     *
     * @param page 0 이상의 페이지 번호
     * @param size 1~100개의 페이지 크기
     * @return 본문 없는 목록과 전체 건수의 [PostPageResponse]
     * @throws InvalidPostRequestException 페이지 값 또는 SQL 오프셋이 허용 범위를 벗어날 때
     */
    @Transactional(readOnly = true)
    fun listDrafts(page: Int, size: Int): PostPageResponse {
        if (page < 0 || size !in 1..MAX_PAGE_SIZE || page.toLong() * size > Int.MAX_VALUE) {
            throw InvalidPostRequestException()
        }
        val result = repository.findAdminSummaries(PageRequest.of(page, size))
        val metadata = taxonomy.batch(result.content.map { it.id }, result.content.map { it.categoryId })
        val items = result.content.map { row ->
            val view = metadata.getValue(row.id)
            PostSummaryResponse(row.id, row.title, row.slug, row.createdAt, row.updatedAt,
                row.status, row.visibility, row.publishedAt, view.category, view.tags,
                row.section, row.projectId, null, row.courseId, row.summary,
                row.techSeriesOrder, row.projectName, row.courseName, row.courseField,
                row.documentOrder, row.chapterOrder)
        }
        return PostPageResponse(items, page, size, result.totalElements, result.totalPages)
    }

    /**
     * 양수 ID의 게시글을 찾아 제목·본문을 한 트랜잭션에서 교체하고 주소는 유지.
     *
     * 다른 쓰기 실패 시 모든 필드가 롤백됨.
     * [PostRepository.findLockedById]로 상태 전환과 같은 행을 잠가 출간 필드 덮어쓰기를 방지함.
     * DB 원문과 첨부 연결의 트랜잭션 경계를 유지함.
     *
     * @param id 수정할 양수 식별자
     * @param title 앞뒤 공백을 제거할 새 제목
     * @param body 원문 그대로 저장할 새 본문
     * @return ID·생성 시각을 유지하고 수정 시각을 갱신한 [PostEntity]
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 해당 글이 없을 때
     * @throws InvalidPostDraftException 입력 계약이 잘못되었을 때
     */
    @Transactional
    @ContentMutation(publication = PublicationChange.IF_PUBLISHED)
    fun updateDraft(id: Long, title: String, body: String): PostEntity {
        if (id <= 0) throw InvalidPostRequestException()
        val post = repository.findLockedById(id) ?: throw PostNotFoundException()
        requireTech(post)
        val values = validateDraft(title, body)
        post.replaceDraft(values.title, values.body, now())
        post.replaceSummary(PostSummaryText.fromBody(values.body))
        return saveDraft(post, post.slug)
    }

    /**
     * 양수 ID의 게시글 행을 잠가 삭제하고 같은 트랜잭션에서 SQL을 동기화.
     *
     * FK로 연결 행만 함께 제거하며 로컬 원본 파일는 건드리지 않음.
     * 커밋 뒤 이전 본문 버전 키를 best-effort 제거함.
     *
     * @param id 삭제할 식별자
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 해당 글이 없을 때
     */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun deleteDraft(id: Long) {
        if (id <= 0) throw InvalidPostRequestException()
        val post = repository.findLockedById(id) ?: throw PostNotFoundException()
        requireTech(post)
        markdown.deletePost(post)
        repository.delete(post)
        repository.flush()
    }

    /**
     * 행을 잠근 뒤 지정 범위로 출간·재출간하고 최초 출간 시각을 보존.
     * DB 원문과 첨부 연결의 트랜잭션 경계를 유지함.
     *
     * @param id 양수 게시글 ID
     * @param visibility 공개 또는 로그인 열람 범위
     * @return 변경된 [PostEntity]
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 게시글이 없을 때
     */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun publish(id: Long, visibility: PostVisibility): PostEntity {
        val post = lockedPost(id)
        requireTech(post)
        if (post.status != io.github.gjaku1031.kenblog.post.domain.PostStatus.PUBLISHED) markdown.movePost(post, true)
        post.publish(visibility, now())
        return repository.saveAndFlush(post)
    }

    /**
     * 행을 잠근 뒤 초안으로 철회하며 최초 출간 시각은 보존.
     * DB 원문과 첨부 연결의 트랜잭션 경계를 유지함.
     *
     * @param id 양수 게시글 ID
     * @return 초안 상태의 [PostEntity]
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 게시글이 없을 때
     */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun unpublish(id: Long): PostEntity {
        val post = lockedPost(id)
        requireTech(post)
        if (post.status == io.github.gjaku1031.kenblog.post.domain.PostStatus.PUBLISHED) markdown.movePost(post, false)
        post.unpublish(now())
        return repository.saveAndFlush(post)
    }

    /**
     * ID로 저장된 게시글을 조회.
     *
     * @param id 양수 식별자
     * @return [findByIdOrNull]로 찾은 [PostEntity], 없거나 양수가 아니면 `null`
     */
    @Transactional(readOnly = true)
    fun findById(id: Long): PostEntity? = if (id > 0) repository.findByIdOrNull(id) else null

    /**
     * 관리자 ID 상세를 조회 트랜잭션 안에서 분류·정렬 태그와 함께 DTO로 조립.
     *
     * @param id 양수 게시글 ID
     * @return 원문·현재 taxonomy를 포함한 [PostDetailResponse]
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 게시글이 없을 때
     */
    @Transactional(readOnly = true)
    fun adminDetail(id: Long): PostDetailResponse {
        if (id <= 0) throw InvalidPostRequestException()
        return (repository.findByIdOrNull(id) ?: throw PostNotFoundException()).adminDetail()
    }

    /**
     * 기존 [createDraft] 계약을 유지하며 새 글의 이미지 연결을 같은 트랜잭션에 저장.
     * 생략·null 목록은 빈 연결, 명시적 목록은 READY 확인 후 선언함.
     *
     * @param attachmentIds 선택적 첨부 ID 전체 목록
     * @param wikiTargets 선택적 제목 선언; 새 글에서 생략하면 빈 연결
     * @return taxonomy와 이미지 연결을 포함한 커밋 예정 [PostDetailResponse]
     * @throws io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure ID가 없거나 READY가 아닐 때
     */
    @Transactional
    @ContentMutation
    fun createDraftDetail(title: String, body: String, attachmentIds: List<Long>? = null,
        wikiTargets: List<String>? = null): PostDetailResponse {
        val post = createDraft(title, body)
        attachmentLinks.replacePost(post.id ?: error("Persisted post has no ID"), attachmentIds ?: emptyList())
        wikiLinks.replacePost(post.id ?: error("Persisted post has no ID"), wikiTargets ?: emptyList())
        return post.adminDetail()
    }

    /**
     * [updateDraft]와 같은 트랜잭션에서 연결을 선택적으로 교체하고 관리자 상세를 조립.
     * 생략·null은 기존 연결 유지, 빈 목록은 전부 해제함.
     *
     * @param attachmentIds 선택적 첨부 ID 전체 목록
     * @param wikiTargets 명시 배열은 전체 교체; 생략하면 본문 변경 시 해제·동일 본문 시 유지
     * @return 기존 또는 교체된 연결을 포함한 커밋 예정 [PostDetailResponse]
     * @throws io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure ID가 없거나 READY가 아닐 때
     */
    @Transactional
    @ContentMutation(publication = PublicationChange.IF_PUBLISHED)
    fun updateDraftDetail(id: Long, title: String, body: String, attachmentIds: List<Long>? = null,
        wikiTargets: List<String>? = null): PostDetailResponse {
        if (id <= 0) throw InvalidPostRequestException()
        val locked = repository.findLockedById(id) ?: throw PostNotFoundException()
        requireTech(locked)
        val previousBody = markdown.readPost(locked)
        val post = updateDraft(id, title, body)
        if (attachmentIds != null) attachmentLinks.replacePost(id, attachmentIds)
        if (wikiTargets != null || previousBody != body) wikiLinks.replacePost(id, wikiTargets ?: emptyList())
        return post.adminDetail()
    }

    /**
     * 본문 SHA-256을 잠긴 부모 행에서 확인하고 본문·updatedAt은 건드리지 않은 채 선언만 교체.
     * @throws WikiLinkConflictException 본문이 보정 도구의 조회 뒤 변경됐을 때
     */
    @Transactional
    @ContentMutation(publication = PublicationChange.IF_PUBLISHED)
    fun replaceWikiLinks(id: Long, expectedBodySha256: String, wikiTargets: List<String>): PostDetailResponse {
        val post = lockedPost(id)
        requireTech(post)
        if (PostBodyHash.sha256(markdown.readPost(post)) != expectedBodySha256) throw WikiLinkConflictException()
        wikiLinks.replacePost(id, wikiTargets)
        return post.adminDetail()
    }

    /** @return [publish]가 변경한 행을 같은 잠금 트랜잭션에서 조립한 상세. */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun publishDetail(id: Long, visibility: PostVisibility): PostDetailResponse = publish(id, visibility).adminDetail()

    /** @return [unpublish]가 변경한 행을 같은 잠금 트랜잭션에서 조립한 상세. */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun unpublishDetail(id: Long): PostDetailResponse = unpublish(id).adminDetail()

    /** @return 초안을 포함한 모든 게시글의 태그 사용 글 수·이름 정렬 목록. */
    @Transactional(readOnly = true)
    fun adminTags(): List<TagCountResponse> = tags.findAdminCounts()

    /** 웹 관리자에서 제목·요약·분류·태그만 교체하며 Markdown 파일은 읽기만 함. */
    @Transactional
    @ContentMutation(publication = PublicationChange.IF_PUBLISHED)
    fun updateMetadata(id: Long, title: String, summary: String, categoryId: Long?,
        rawTags: List<String>): PostDetailResponse {
        if (id <= 0 || summary.codePointCount(0, summary.length) > 120) throw InvalidPostRequestException()
        val normalizedTitle = title.trim()
        if (normalizedTitle.isBlank() || normalizedTitle.codePointCount(0, normalizedTitle.length) > 200)
            throw InvalidPostDraftException("제목은 공백이 아닌 1~200자여야 합니다.")
        val normalizedTags = TagNames.displayAll(rawTags)
        if (categoryId != null) {
            if (categoryId <= 0) throw InvalidPostRequestException()
            categories.findSharedById(categoryId) ?: throw CategoryNotFoundException()
        }
        val post = lockedPost(id)
        if (post.section != PostSection.TECH && post.section != PostSection.PROJECT_DOC)
            throw ProjectConflictException()
        val normalizedSummary = summary.trim().ifEmpty { PostSummaryText.fromBody(markdown.readPost(post)) }
        if (post.title == normalizedTitle && post.summary == normalizedSummary &&
            post.categoryId == categoryId && tags.findNamesByPostId(id) == normalizedTags) return post.adminDetail()
        post.replaceMetadata(normalizedTitle, normalizedSummary, now())
        if (post.categoryId != categoryId) post.changeCategory(categoryId, now())
        repository.saveAndFlush(post)
        if (tags.findNamesByPostId(id) != normalizedTags) {
            tags.deleteByPostId(id)
            if (normalizedTags.isNotEmpty())
                tags.saveAllAndFlush(normalizedTags.mapIndexed { index, name -> PostTagEntity(id, index, name) })
        }
        return post.adminDetail()
    }

    /**
     * 대상 분류 공유 잠금 다음 글 배타 잠금 순서로 분류·태그를 원자적으로 전체 교체.
     *
     * @param id 양수 게시글 ID
     * @param categoryId 존재하는 분류 ID 또는 명시적 해제 `null`
     * @param rawTags 입력 순서를 유지할 문자열 태그
     * @return 변경된 관리자 상세 [PostDetailResponse]
     * @throws InvalidPostRequestException 태그·ID 형식이 잘못되었을 때
     * @throws CategoryNotFoundException 양수 분류 ID가 없을 때
     * @throws PostNotFoundException 게시글이 없을 때
     * @throws CategoryConflictException FK 또는 잠금 경합일 때
     */
    @Transactional
    @ContentMutation(publication = PublicationChange.IF_PUBLISHED)
    fun replaceTaxonomy(id: Long, categoryId: Long?, rawTags: List<String>): PostDetailResponse {
        if (id <= 0) throw InvalidPostRequestException()
        val normalized = TagNames.displayAll(rawTags)
        return try {
            if (categoryId != null) {
                if (categoryId <= 0) throw InvalidPostRequestException()
                categories.findSharedById(categoryId) ?: throw CategoryNotFoundException()
            }
            val post = lockedPost(id)
            if (post.section != PostSection.TECH && post.section != PostSection.PROJECT_DOC)
                throw ProjectConflictException()
            if (post.categoryId == categoryId && tags.findNamesByPostId(id) == normalized) return post.adminDetail()
            post.changeCategory(categoryId, now())
            repository.saveAndFlush(post)
            tags.deleteByPostId(id)
            if (normalized.isNotEmpty()) {
                tags.saveAllAndFlush(normalized.mapIndexed { index, name -> PostTagEntity(id, index, name) })
            }
            post.adminDetail()
        } catch (ex: DataIntegrityViolationException) {
            throw CategoryConflictException()
        } catch (ex: PessimisticLockingFailureException) {
            throw CategoryConflictException()
        }
    }

    /**
     * 입력 slug를 생성 시와 같은 규칙으로 정규화하여 조회.
     *
     * @param slug 조회할 주소
     * @return 일치하는 [PostEntity], 형식이 잘못되거나 없으면 `null`
     */
    @Transactional(readOnly = true)
    fun findBySlug(slug: String): PostEntity? {
        val normalized = normalizeSlug(slug)
        return if (normalized.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.matches(normalized)) {
            repository.findBySlug(normalized)
        } else null
    }

    /**
     * 출간 상태 변경에서 공통으로 사용할 양수 ID의 잠긴 엔티티를 조회.
     *
     * @param id 게시글 ID
     * @return 잠근 [PostEntity]
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 게시글이 없을 때
     */
    private fun lockedPost(id: Long): PostEntity {
        if (id <= 0) throw InvalidPostRequestException()
        return repository.findLockedById(id) ?: throw PostNotFoundException()
    }

    /** @return 현재 트랜잭션에서 같은 글의 분류·태그를 결합한 관리자 원문 DTO. */
    private fun PostEntity.adminDetail(): PostDetailResponse {
        val postId = id ?: error("Persisted post has no ID")
        val view = taxonomy.one(postId, categoryId)
        val project = projectId?.let(projects::findByIdOrNull)
        val course = courseId?.let(courses::findByIdOrNull)
        val fileBody = markdown.readPost(this)
        return PostDetailResponse(postId, title, slug, fileBody, createdAt, updatedAt,
            status, visibility, publishedAt, view.category, view.tags, attachmentLinks.postIds(postId), wikiLinks.postTitles(postId),
            section, projectId, project?.slug, relatedProjectId, documentOrder,
            if (section == PostSection.PROJECT_HOME && project != null)
                io.github.gjaku1031.kenblog.project.domain.ProjectMetadata(project.status, project.startPeriod,
                    project.endPeriod, project.overview, project.visibility, project.updatedAt,
                    stackBadges.listForProject(project.id!!).map { it.name })
            else null, courseId, course?.slug, chapterOrder, summary, PostBodyHash.sha256(fileBody),
            techSeriesOrder)
    }

    /** 일반 관리자 글 쓰기가 대문·문서의 부모 원자성 규칙을 우회하지 못하게 차단. */
    private fun requireTech(post: PostEntity) { if (post.section != PostSection.TECH) throw ProjectConflictException() }

    /** 이미 잠근 프로젝트 아래 새 HOME 또는 DOC 글을 저장. */
    @Transactional
    @ContentMutation
    fun createProjectPost(draft: EditorDraftEntity, section: PostSection,
        projectId: Long, order: Int?, body: String = draft.body): PostEntity {
        if (section !in setOf(PostSection.PROJECT_HOME, PostSection.PROJECT_DOC) || projectId <= 0 ||
            (section == PostSection.PROJECT_DOC && (order ?: 0) <= 0)) throw ProjectConflictException()
        val values = validateDraft(draft.title, body)
        val slug = if (section == PostSection.PROJECT_HOME)
            (projects.findByIdOrNull(projectId) ?: throw ProjectConflictException()).slug
        else ContentAddress.publishDraft(draft.slug, section)
        val entity = PostEntity(values.title, slug, values.body, now())
        entity.assignProject(section, projectId, order)
        return saveDraft(entity, slug)
    }

    /** 부모 잠금과 소속 확인 뒤 공개 원문의 HOME·DOC 내용만 교체. */
    @Transactional
    @ContentMutation(publication = PublicationChange.IF_PUBLISHED)
    fun updateProjectPost(id: Long, title: String, body: String,
        section: PostSection, projectId: Long, order: Int? = null): PostEntity {
        val post = lockedPost(id)
        if (section !in setOf(PostSection.PROJECT_HOME, PostSection.PROJECT_DOC) ||
            post.section != section || post.projectId != projectId) throw ProjectConflictException()
        val values = validateDraft(title, body)
        post.replaceDraft(values.title, values.body, now())
        if (order != null) {
            if (section != PostSection.PROJECT_DOC || order <= 0) throw InvalidPostRequestException()
            post.reorder(order)
        }
        return saveDraft(post, post.slug)
    }

    /** 프로젝트 원문만 별도 부모 트랜잭션에서 출간. */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun publishProjectPost(id: Long, visibility: PostVisibility): PostEntity {
        val post = lockedPost(id)
        if (post.section !in setOf(PostSection.PROJECT_HOME, PostSection.PROJECT_DOC)) throw ProjectConflictException()
        if (post.status != io.github.gjaku1031.kenblog.post.domain.PostStatus.PUBLISHED) markdown.movePost(post, true)
        post.publish(visibility, now())
        return repository.saveAndFlush(post)
    }

    /** TECH 글의 선택적 관련 프로젝트를 출간 트랜잭션에서 지정·해제. */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun relateTechPost(id: Long, projectId: Long?) {
        val post = lockedPost(id)
        requireTech(post)
        post.relateProject(projectId, now())
        repository.saveAndFlush(post)
    }

    /** [EditorDraftService.publish]가 잠근 소분류에서 검증한 번호를 TECH 원문에 저장. */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun setTechSeriesOrder(id: Long, order: Int?) {
        val post = lockedPost(id)
        requireTech(post)
        if (order != null && (order <= 0 || post.categoryId == null)) throw InvalidPostRequestException()
        if (post.techSeriesOrder == order) return
        post.changeTechSeriesOrder(order, now())
        repository.saveAndFlush(post)
    }

    /** 편집본의 명시 요약 또는 본문 자동 추출을 같은 원문 트랜잭션에서 저장. */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun replaceSummary(id: Long, requested: String) {
        val post = lockedPost(id)
        if (requested.codePointCount(0, requested.length) > 120) throw InvalidPostRequestException()
        post.replaceSummary(if (requested.isBlank()) PostSummaryText.fromBody(markdown.readPost(post)) else requested.trim())
        repository.saveAndFlush(post)
    }

    /** 과목 잠금 뒤 검증한 회차 원문을 새 게시글로 저장. */
    @Transactional
    @ContentMutation
    fun createChapterPost(draft: EditorDraftEntity, courseId: Long, order: Int,
        body: String = draft.body): PostEntity {
        if (courseId <= 0 || order <= 0) throw io.github.gjaku1031.kenblog.note.domain.CourseConflictException()
        val values = validateDraft(draft.title, body)
        val slug = ContentAddress.publishDraft(draft.slug, PostSection.NOTE_CHAPTER)
        val post = PostEntity(values.title, slug, values.body, now())
        post.assignCourse(courseId, order)
        return saveDraft(post, slug)
    }

    /** 과목과 소속을 다시 확인한 뒤 회차 원문만 갱신. */
    @Transactional
    @ContentMutation(publication = PublicationChange.IF_PUBLISHED)
    fun updateChapterPost(id: Long, title: String, body: String, courseId: Long, order: Int? = null): PostEntity {
        val post = lockedPost(id)
        if (post.section != PostSection.NOTE_CHAPTER || post.courseId != courseId)
            throw io.github.gjaku1031.kenblog.note.domain.CourseConflictException()
        val values = validateDraft(title, body)
        post.replaceDraft(values.title, values.body, now())
        if (order != null) {
            if (order <= 0) throw InvalidPostRequestException()
            post.reorderChapter(order)
        }
        return saveDraft(post, post.slug)
    }

    /** 기존 출간 경로와 동일하게 회차의 첫 출간 시각을 보존. */
    @Transactional
    @ContentMutation(publication = PublicationChange.ALWAYS)
    fun publishChapterPost(id: Long, visibility: PostVisibility): PostEntity {
        val post = lockedPost(id)
        if (post.section != PostSection.NOTE_CHAPTER) throw io.github.gjaku1031.kenblog.note.domain.CourseConflictException()
        if (post.status != io.github.gjaku1031.kenblog.post.domain.PostStatus.PUBLISHED) markdown.movePost(post, true)
        post.publish(visibility, now())
        return repository.saveAndFlush(post)
    }

    /**
     * 기존 생성·새 수정 경로에서 같은 제목·본문 계약을 적용.
     *
     * @param title 원본 제목
     * @param body 원본 본문
     * @return 정규화된 제목과 변형하지 않은 본문
     * @throws InvalidPostDraftException 길이·형식 상한을 벗어날 때
     */
    private fun validateDraft(title: String, body: String): DraftValues {
        val normalizedTitle = title.trim()
        if (normalizedTitle.isBlank() || normalizedTitle.codePointCount(0, normalizedTitle.length) > MAX_TITLE_LENGTH) {
            throw InvalidPostDraftException("제목은 공백이 아닌 1~200자여야 합니다.")
        }
        if (body.toByteArray(Charsets.UTF_8).size > MAX_BODY_BYTES) {
            throw InvalidPostDraftException("본문은 UTF-8로 1 MiB 이하여야 합니다.")
        }
        return DraftValues(normalizedTitle, body)
    }

    /**
     * 현재 트랜잭션에서 저장·flush하고 이름 있는 slug 충돌만 도메인 예외로 변환.
     *
     * @param post 생성 또는 변경한 [PostEntity]
     * @param slug 오류 원인에 사용할 정규화된 주소
     * @return JPA가 저장 후 반환한 [PostEntity]
     * @throws DuplicatePostSlugException `uk_posts_slug` 위반일 때
     * @throws DataIntegrityViolationException 다른 DB 제약 위반일 때
     */
    private fun saveDraft(post: PostEntity, slug: String): PostEntity = try {
        val saved = repository.saveAndFlush(post)
        markdown.writePost(saved, saved.body)
        saved
    } catch (ex: DataIntegrityViolationException) {
        if (ex.isDuplicateSlugConstraint()) throw DuplicatePostSlugException(slug, ex)
        throw ex
    }

    /** @return UTC의 마이크로초 정밀도로 자른 생성·수정 시각. */
    private fun now(): LocalDateTime = LocalDateTime.ofInstant(Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)

    /**
     * 입력 slug의 양끝 공백을 제거하고 지역 설정과 무관하게 ASCII 소문자로 정규화.
     *
     * @param slug 정규화할 입력
     * @return 검증 전의 정규화된 문자열
     */
    private fun normalizeSlug(slug: String): String = slug.trim().lowercase(Locale.ROOT)

    /**
     * MySQL의 이름 있는 slug 고유 제약 위반만 도메인 충돌로 식별.
     *
     * @return MySQL 중복 키 오류 1062가 `uk_posts_slug`를 지목하면 `true`
     */
    private fun DataIntegrityViolationException.isDuplicateSlugConstraint(): Boolean =
        generateSequence<Throwable>(this) { it.cause }.any { cause ->
            cause is SQLIntegrityConstraintViolationException &&
                cause.errorCode == MYSQL_DUPLICATE_KEY &&
                cause.message?.contains("uk_posts_slug") == true
        }

    /** 생성·수정 경로에 공통으로 전달하는 검증된 초안 값. */
    private data class DraftValues(val title: String, val body: String)

    private companion object {
        const val MAX_TITLE_LENGTH = 200
        const val MAX_SLUG_LENGTH = 160
        const val MAX_BODY_BYTES = 1024 * 1024
        const val MYSQL_DUPLICATE_KEY = 1062
        const val MAX_PAGE_SIZE = 100
        val SLUG_PATTERN = Regex("[a-z0-9]+(?:-[a-z0-9]+)*")
    }
}
