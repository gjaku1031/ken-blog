package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.swagger.v3.oas.annotations.media.Schema
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * 관리자 POST·PUT의 전체 교체 입력. 필수 문자열 누락과 JSON null은 역직렬화에서 400으로 판정함.
 *
 * @property title 앞뒤 공백을 제거해 검증할 제목
 * @property slug 소문자 ASCII 형식으로 정규화할 주소
 * @property body 빈 문자열도 허용하는 원문 본문
 */
data class PostWriteRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"], description = "1~200자 제목")
    val title: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"], description = "1~160자 소문자 ASCII slug")
    val slug: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"], description = "UTF-8 최대 1 MiB, 빈 문자열 허용")
    val body: String,
)

/**
 * 관리자 출간·공개 범위 변경의 필수 입력. 누락·null은 역직렬화에서 400이 됨.
 * 숫자·불리언이 문자열로 변환되어도 [selectedVisibility]가 허용 값만 통과시킴.
 *
 * @property visibility 공개 또는 로그인 열람 범위
 */
data class PostVisibilityRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"], allowableValues = ["PUBLIC", "PRIVATE"])
    val visibility: String,
) {
    /**
     * JSON 스칼라 입력을 정확한 대문자 공개 범위로 변환.
     *
     * @return 지원하는 [PostVisibility]
     * @throws InvalidPostRequestException 숫자·불리언·지원하지 않는 문자열일 때
     */
    fun selectedVisibility(): PostVisibility = when (visibility) {
        "PUBLIC" -> PostVisibility.PUBLIC
        "PRIVATE" -> PostVisibility.PRIVATE
        else -> throw InvalidPostRequestException()
    }
}

/**
 * 관리자 상세 조회의 초안 또는 출간 내용. [PostEntity] 자체를 JSON으로 노출하지 않음.
 *
 * @property id 게시글 식별자
 * @property title 저장된 제목
 * @property slug 정규화된 주소
 * @property body 원문 그대로의 본문
 * @property createdAt UTC 생성 시각
 * @property updatedAt UTC 마지막 수정 시각
 * @property status 초안 또는 출간 상태
 * @property visibility 출간 시 열람 범위
 * @property publishedAt 최초 UTC 출간 시각; 아직 출간한 적 없으면 `null`
 */
data class PostDetailResponse(
    val id: Long,
    val title: String,
    val slug: String,
    val body: String,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime,
    val status: PostStatus,
    val visibility: PostVisibility,
    val publishedAt: LocalDateTime?,
)

/**
 * 본문 열을 제외한 관리자 목록 행. [io.github.gjaku1031.kenblog.post.repository.PostRepository.findAdminSummaries]가 직접 생성함.
 *
 * @property id 게시글 식별자
 * @property title 저장된 제목
 * @property slug 정규화된 주소
 * @property createdAt UTC 생성 시각
 * @property updatedAt UTC 마지막 수정 시각
 * @property status 초안 또는 출간 상태
 * @property visibility 출간 시 열람 범위
 * @property publishedAt 최초 UTC 출간 시각; 아직 출간한 적 없으면 `null`
 */
data class PostSummaryResponse(
    val id: Long,
    val title: String,
    val slug: String,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime,
    val status: PostStatus,
    val visibility: PostVisibility,
    val publishedAt: LocalDateTime?,
)

/**
 * 관리자 게시글 목록과 페이지 정보. 초안·출간 글을 포함하며 Spring Data의 Page는 노출하지 않음.
 *
 * @property items 본문 없는 목록 행
 * @property page 0 기반 현재 페이지
 * @property size 요청한 페이지 크기
 * @property totalElements 초안·출간 글을 합친 전체 수
 * @property totalPages 전체 페이지 수
 */
data class PostPageResponse(
    val items: List<PostSummaryResponse>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)

/**
 * 본문 열 없이 SQL에서 가져오는 출간 글 목록 행. HTTP 변환 때 최초 시각을 KST 날짜로 변환함.
 *
 * @property id 게시글 ID
 * @property title 제목
 * @property slug 주소
 * @property publishedAt 최초 UTC 출간 시각
 */
data class PublishedPostRow(val id: Long, val title: String, val slug: String, val publishedAt: LocalDateTime)

/**
 * 익명 비공개 직접 조회에서 본문 열을 읽지 않는 잠금 화면용 최소 SQL 행.
 *
 * @property id 게시글 ID
 * @property title 제목
 * @property slug 주소
 * @property publishedAt 최초 UTC 출간 시각
 */
data class PrivatePostLockRow(val id: Long, val title: String, val slug: String, val publishedAt: LocalDateTime)

/**
 * 권한 필터를 거친 공개 목록의 본문 없는 항목.
 *
 * @property id 게시글 ID
 * @property title 제목
 * @property slug 주소
 * @property publishedDate 최초 출간 시각의 Asia/Seoul 날짜
 */
data class PublicPostSummaryResponse(val id: Long, val title: String, val slug: String, val publishedDate: LocalDate)

/**
 * 공개/로그인 열람자 또는 익명 비공개 잠금 화면에 제공하는 상세.
 *
 * 익명 PRIVATE일 때 [locked]는 `true`, [body]는 반드시 `null`임.
 *
 * @property id 게시글 ID
 * @property title 제목 또는 잠금 화면 허용 제목
 * @property slug 주소
 * @property publishedDate 최초 출간 시각의 Asia/Seoul 날짜
 * @property locked 본문 접근이 잠겨 있는지 여부
 * @property body 접근이 허용된 원문 본문, 잠금 상태면 `null`
 */
data class PublicPostDetailResponse(
    val id: Long,
    val title: String,
    val slug: String,
    val publishedDate: LocalDate,
    val locked: Boolean,
    val body: String?,
)

/**
 * 권한별 SQL 조회와 건수를 함께 담는 공개 목록 응답.
 *
 * @property items 본문 없는 게시글 목록
 * @property page 0 기반 현재 페이지
 * @property size 요청한 페이지 크기
 * @property totalElements 현재 열람 권한의 전체 글 수
 * @property totalPages 현재 열람 권한의 전체 페이지 수
 */
data class PublicPostPageResponse(
    val items: List<PublicPostSummaryResponse>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)
