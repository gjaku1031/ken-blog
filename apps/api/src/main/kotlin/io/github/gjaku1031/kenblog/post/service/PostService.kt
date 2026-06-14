package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.category.domain.CategoryConflictException
import io.github.gjaku1031.kenblog.category.domain.CategoryNotFoundException
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.post.domain.DuplicatePostSlugException
import io.github.gjaku1031.kenblog.post.domain.InvalidPostDraftException
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.PostTagEntity
import io.github.gjaku1031.kenblog.post.domain.TagNames
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PostPageResponse
import io.github.gjaku1031.kenblog.post.dto.PostSummaryResponse
import io.github.gjaku1031.kenblog.post.dto.TagCountResponse
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import io.github.gjaku1031.kenblog.post.repository.PostTagRepository
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
 * @property cache 커밋 후 이전 PUBLIC 본문 키를 제거하는 선택적 캐시
 */
@Service
class PostService(
    private val repository: PostRepository,
    private val cache: PostBodyCache,
    private val categories: CategoryRepository,
    private val tags: PostTagRepository,
    private val taxonomy: PostTaxonomyMetadata,
) {
    /**
     * 제목과 slug를 정규화한 후 초안을 원자적으로 저장.
     *
     * 제목은 Unicode 코드 포인트 1~200자, slug는 소문자 ASCII 영숫자와 단일
     * 하이픈 구분자로 1~160자, 본문은 UTF-8 1 MiB 이하. DB의 고유 제약이
     * 동시 저장 경쟁을 최종 판정함.
     * [PostRepository.saveAndFlush]는 SQL을 동기화하지만 트랜잭션을 커밋하지 않음.
     * 이 호출 중 MySQL `uk_posts_slug` 중복 오류만 도메인 예외로 변환함.
     *
     * @param title 앞뒤 공백을 제거할 제목
     * @param slug 앞뒤 공백 제거 및 소문자 변환할 주소
     * @param body 원문 그대로 저장할 초안 본문
     * @return ID와 생성·수정 시각이 채워진 [PostEntity]
     * @throws InvalidPostDraftException 입력 계약을 충족하지 않을 때
     * @throws DuplicatePostSlugException 고유 slug 제약과 충돌할 때
     * @throws DataIntegrityViolationException 다른 저장 제약 오류가 발생할 때
     */
    @Transactional
    fun createDraft(title: String, slug: String, body: String): PostEntity {
        val values = validateDraft(title, slug, body)
        return saveDraft(PostEntity(values.title, values.slug, values.body, now()), values.slug)
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
                row.status, row.visibility, row.publishedAt, view.category, view.tags)
        }
        return PostPageResponse(items, page, size, result.totalElements, result.totalPages)
    }

    /**
     * 양수 ID의 게시글을 찾아 제목·slug·본문 전체를 한 트랜잭션에서 교체.
     *
     * 동일 slug 유지도 DB 고유 제약에 맡기며, 충돌이나 다른 쓰기 실패 시 모든 필드가 롤백됨.
     * [PostRepository.findLockedById]로 상태 전환과 같은 행을 잠가 출간 필드 덮어쓰기를 방지함.
     * 커밋 뒤 변경 전 본문 버전 키를 best-effort 제거함.
     *
     * @param id 수정할 양수 식별자
     * @param title 앞뒤 공백을 제거할 새 제목
     * @param slug 정규화할 새 주소
     * @param body 원문 그대로 저장할 새 본문
     * @return ID·생성 시각을 유지하고 수정 시각을 갱신한 [PostEntity]
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 해당 글이 없을 때
     * @throws InvalidPostDraftException 입력 계약이 잘못되었을 때
     * @throws DuplicatePostSlugException 다른 글의 slug와 충돌할 때
     */
    @Transactional
    fun updateDraft(id: Long, title: String, slug: String, body: String): PostEntity {
        if (id <= 0) throw InvalidPostRequestException()
        val post = repository.findLockedById(id) ?: throw PostNotFoundException()
        val previousHash = post.bodySha256
        val values = validateDraft(title, slug, body)
        post.replaceDraft(values.title, values.slug, values.body, now())
        return saveDraft(post, values.slug).also { cache.evictAfterCommit(id, previousHash) }
    }

    /**
     * 양수 ID의 게시글 행을 잠가 삭제하고 같은 트랜잭션에서 SQL을 동기화.
     *
     * 아직 게시글과 첨부의 연결이 없어 OCI 객체는 건드리지 않음.
     * 커밋 뒤 이전 본문 버전 키를 best-effort 제거함.
     *
     * @param id 삭제할 식별자
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 해당 글이 없을 때
     */
    @Transactional
    fun deleteDraft(id: Long) {
        if (id <= 0) throw InvalidPostRequestException()
        val post = repository.findLockedById(id) ?: throw PostNotFoundException()
        val previousHash = post.bodySha256
        repository.delete(post)
        repository.flush()
        cache.evictAfterCommit(id, previousHash)
    }

    /**
     * 행을 잠근 뒤 지정 범위로 출간·재출간하고 최초 출간 시각을 보존.
     * 커밋 뒤 변경 전 본문 버전 키를 best-effort 제거함.
     *
     * @param id 양수 게시글 ID
     * @param visibility 공개 또는 로그인 열람 범위
     * @return 변경된 [PostEntity]
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 게시글이 없을 때
     */
    @Transactional
    fun publish(id: Long, visibility: PostVisibility): PostEntity {
        val post = lockedPost(id)
        val previousHash = post.bodySha256
        post.publish(visibility, now())
        return repository.saveAndFlush(post).also { cache.evictAfterCommit(id, previousHash) }
    }

    /**
     * 행을 잠근 뒤 초안으로 철회하며 최초 출간 시각은 보존.
     * 커밋 뒤 변경 전 본문 버전 키를 best-effort 제거함.
     *
     * @param id 양수 게시글 ID
     * @return 초안 상태의 [PostEntity]
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 게시글이 없을 때
     */
    @Transactional
    fun unpublish(id: Long): PostEntity {
        val post = lockedPost(id)
        val previousHash = post.bodySha256
        post.unpublish(now())
        return repository.saveAndFlush(post).also { cache.evictAfterCommit(id, previousHash) }
    }

    /**
     * 행을 잠근 뒤 출간 상태와 최초 출간 시각을 그대로 두고 범위만 변경.
     * 커밋 뒤 변경 전 본문 버전 키를 best-effort 제거함.
     *
     * @param id 양수 게시글 ID
     * @param visibility 새 공개 범위
     * @return 변경된 [PostEntity]
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 게시글이 없을 때
     */
    @Transactional
    fun changeVisibility(id: Long, visibility: PostVisibility): PostEntity {
        val post = lockedPost(id)
        val previousHash = post.bodySha256
        post.changeVisibility(visibility, now())
        return repository.saveAndFlush(post).also { cache.evictAfterCommit(id, previousHash) }
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
     * 기존 [createDraft] 계약을 유지하면서 HTTP에는 같은 쓰기 트랜잭션의 taxonomy 포함 상세를 반환.
     *
     * @return 커밋할 초안의 [PostDetailResponse]
     */
    @Transactional
    fun createDraftDetail(title: String, slug: String, body: String): PostDetailResponse =
        createDraft(title, slug, body).adminDetail()

    /** @return 기존 [updateDraft]와 같은 트랜잭션에서 확정한 관리자 상세. */
    @Transactional
    fun updateDraftDetail(id: Long, title: String, slug: String, body: String): PostDetailResponse =
        updateDraft(id, title, slug, body).adminDetail()

    /** @return [publish]가 변경한 행을 같은 잠금 트랜잭션에서 조립한 상세. */
    @Transactional
    fun publishDetail(id: Long, visibility: PostVisibility): PostDetailResponse = publish(id, visibility).adminDetail()

    /** @return [unpublish]가 변경한 행을 같은 잠금 트랜잭션에서 조립한 상세. */
    @Transactional
    fun unpublishDetail(id: Long): PostDetailResponse = unpublish(id).adminDetail()

    /** @return [changeVisibility]가 변경한 행을 같은 잠금 트랜잭션에서 조립한 상세. */
    @Transactional
    fun changeVisibilityDetail(id: Long, visibility: PostVisibility): PostDetailResponse =
        changeVisibility(id, visibility).adminDetail()

    /** @return 초안을 포함한 모든 게시글의 태그 사용 글 수·이름 정렬 목록. */
    @Transactional(readOnly = true)
    fun adminTags(): List<TagCountResponse> = tags.findAdminCounts()

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
    fun replaceTaxonomy(id: Long, categoryId: Long?, rawTags: List<String>): PostDetailResponse {
        if (id <= 0) throw InvalidPostRequestException()
        val normalized = TagNames.normalizeAll(rawTags)
        return try {
            if (categoryId != null) {
                if (categoryId <= 0) throw InvalidPostRequestException()
                categories.findSharedById(categoryId) ?: throw CategoryNotFoundException()
            }
            val post = lockedPost(id)
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
        return PostDetailResponse(postId, title, slug, body, createdAt, updatedAt,
            status, visibility, publishedAt, view.category, view.tags)
    }

    /**
     * 기존 생성·새 수정 경로에서 같은 제목·slug·본문 계약을 적용.
     *
     * @param title 원본 제목
     * @param slug 원본 주소
     * @param body 원본 본문
     * @return 정규화된 제목·slug와 변형하지 않은 본문
     * @throws InvalidPostDraftException 길이·형식 상한을 벗어날 때
     */
    private fun validateDraft(title: String, slug: String, body: String): DraftValues {
        val normalizedTitle = title.trim()
        val normalizedSlug = normalizeSlug(slug)
        if (normalizedTitle.isBlank() || normalizedTitle.codePointCount(0, normalizedTitle.length) > MAX_TITLE_LENGTH) {
            throw InvalidPostDraftException("제목은 공백이 아닌 1~200자여야 합니다.")
        }
        if (normalizedSlug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.matches(normalizedSlug)) {
            throw InvalidPostDraftException("slug는 1~160자의 소문자 영숫자와 단일 하이픈으로 구성해야 합니다.")
        }
        if (body.toByteArray(Charsets.UTF_8).size > MAX_BODY_BYTES) {
            throw InvalidPostDraftException("본문은 UTF-8로 1 MiB 이하여야 합니다.")
        }
        return DraftValues(normalizedTitle, normalizedSlug, body)
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
        repository.saveAndFlush(post)
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
    private data class DraftValues(val title: String, val slug: String, val body: String)

    private companion object {
        const val MAX_TITLE_LENGTH = 200
        const val MAX_SLUG_LENGTH = 160
        const val MAX_BODY_BYTES = 1024 * 1024
        const val MYSQL_DUPLICATE_KEY = 1062
        const val MAX_PAGE_SIZE = 100
        val SLUG_PATTERN = Regex("[a-z0-9]+(?:-[a-z0-9]+)*")
    }
}
