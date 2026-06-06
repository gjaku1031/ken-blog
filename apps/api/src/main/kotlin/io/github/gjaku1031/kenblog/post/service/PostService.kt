package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.post.domain.DuplicatePostSlugException
import io.github.gjaku1031.kenblog.post.domain.InvalidPostDraftException
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.dto.PostPageResponse
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import java.sql.SQLIntegrityConstraintViolationException
import java.time.Clock
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.Locale
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.PageRequest
import org.springframework.data.repository.findByIdOrNull
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 초안 입력 계약과 [PostRepository]의 생성·목록·수정·삭제를 트랜잭션으로 묶는 서비스.
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
class PostService(private val repository: PostRepository) {
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
     * 본문을 선택하지 않는 고정 정렬의 관리자 초안 목록을 조회.
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
        return PostPageResponse(result.content, page, size, result.totalElements, result.totalPages)
    }

    /**
     * 양수 ID의 초안을 찾아 제목·slug·본문 전체를 한 트랜잭션에서 교체.
     *
     * 동일 slug 유지도 DB 고유 제약에 맡기며, 충돌이나 다른 쓰기 실패 시 모든 필드가 롤백됨.
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
        val post = repository.findByIdOrNull(id) ?: throw PostNotFoundException()
        val values = validateDraft(title, slug, body)
        post.replaceDraft(values.title, values.slug, values.body, now())
        return saveDraft(post, values.slug)
    }

    /**
     * 양수 ID의 초안 행만 삭제하고 같은 트랜잭션에서 SQL을 동기화.
     *
     * 아직 게시글과 첨부의 연결이 없어 OCI 객체는 건드리지 않음.
     *
     * @param id 삭제할 식별자
     * @throws InvalidPostRequestException ID가 양수가 아닐 때
     * @throws PostNotFoundException 해당 글이 없을 때
     */
    @Transactional
    fun deleteDraft(id: Long) {
        if (id <= 0) throw InvalidPostRequestException()
        val post = repository.findByIdOrNull(id) ?: throw PostNotFoundException()
        repository.delete(post)
        repository.flush()
    }

    /**
     * ID로 저장된 초안을 조회.
     *
     * @param id 양수 식별자
     * @return [findByIdOrNull]로 찾은 [PostEntity], 없거나 양수가 아니면 `null`
     */
    @Transactional(readOnly = true)
    fun findById(id: Long): PostEntity? = if (id > 0) repository.findByIdOrNull(id) else null

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
