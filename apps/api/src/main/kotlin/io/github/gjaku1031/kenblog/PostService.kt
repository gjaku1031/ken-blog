package io.github.gjaku1031.kenblog

import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.repository.findByIdOrNull
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.sql.SQLIntegrityConstraintViolationException
import java.time.Clock
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * 내부 초안 입력 계약을 검증하고 [PostRepository]의 저장·조회를 트랜잭션으로 묶는 서비스.
 *
 * 생성에는 새 [PostEntity]의 null ID와 저장 결과를 사용하며, 조회에는
 * [findByIdOrNull]과 저장소의 파생 쿼리를 사용함.
 *
 * 아직 인증 또는 쓰기 HTTP 경로를 제공하지 않음.
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

        val createdAt = LocalDateTime.ofInstant(Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)
        return try {
            repository.saveAndFlush(PostEntity(normalizedTitle, normalizedSlug, body, createdAt))
        } catch (ex: DataIntegrityViolationException) {
            if (ex.isDuplicateSlugConstraint()) throw DuplicatePostSlugException(normalizedSlug, ex)
            throw ex
        }
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

    private companion object {
        const val MAX_TITLE_LENGTH = 200
        const val MAX_SLUG_LENGTH = 160
        const val MAX_BODY_BYTES = 1024 * 1024
        const val MYSQL_DUPLICATE_KEY = 1062
        val SLUG_PATTERN = Regex("[a-z0-9]+(?:-[a-z0-9]+)*")
    }
}
