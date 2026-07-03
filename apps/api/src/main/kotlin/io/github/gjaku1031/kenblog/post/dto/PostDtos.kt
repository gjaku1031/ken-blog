package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.attachment.dto.AttachmentIds
import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.swagger.v3.oas.annotations.media.Schema
import java.time.LocalDate
import java.time.LocalDateTime
import tools.jackson.databind.JsonNode

/**
 * 관리자 POST·PUT의 전체 교체 입력. 필수 문자열 누락과 JSON null은 역직렬화에서 400으로 판정함.
 *
 * @property title 앞뒤 공백을 제거해 검증할 제목
 * @property slug 소문자 ASCII 형식으로 정규화할 주소
 * @property body 빈 문자열도 허용하는 원문 본문
 * @property attachmentIds 생략·null이면 기존 연결 유지, 명시적 배열이면 전체 교체
 * @property wikiTargets 명시적 위키 대상 제목; 생략·null은 본문 변경 여부에 따라 유지 또는 해제
 */
data class PostWriteRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"], description = "1~200자 제목")
    val title: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"], description = "1~160자 소문자 ASCII slug")
    val slug: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"], description = "UTF-8 최대 1 MiB, 빈 문자열 허용")
    val body: String,
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED, types = ["array", "null"], description = "선택적 READY 첨부 ID 최대 100개; 새 글 생략 시 빈 연결")
    val attachmentIds: List<Long>? = null,
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED, types = ["array", "null"], description = "선택적 위키 대상 제목 최대 128개")
    val wikiTargets: List<String>? = null,
)

/** 관리자 게시글 JSON의 문자열과 선택적 첨부 목록을 강제 변환 없이 파싱. */
object PostWriteRequests {
    /** @return 필수 세 문자열과 정렬된 첨부 ID 선언; 잘못된 JSON은 HTTP 400. */
    fun fromJson(node: JsonNode): PostWriteRequest {
        if (!node.isObject) throw InvalidPostRequestException()
        return PostWriteRequest(string(node, "title"), string(node, "slug"), string(node, "body"),
            AttachmentIds.parse(node.get("attachmentIds")), WikiDeclarations.parse(node.get("wikiTargets")))
    }

    /** @return 누락·null·숫자 강제 변환을 거부한 필수 문자열. */
    private fun string(node: JsonNode, name: String): String = node.get(name)?.let {
        if (!it.isTextual) throw InvalidPostRequestException()
        it.textValue()
    } ?: throw InvalidPostRequestException()
}

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
 * @property category 현재 분류 참조, 미지정이면 `null`
 * @property tags 입력 순서대로 저장된 정규화 태그
 * @property attachmentIds 글에 연결하도록 선언된 첨부 ID의 오름차순 목록
 * @property wikiTargets 작성자가 선언한 대상 제목의 원래 순서 목록
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
    val category: CategoryRefResponse?,
    val tags: List<String>,
    val attachmentIds: List<Long>,
    val wikiTargets: List<String>,
)

/**
 * 본문 열을 제외한 관리자 목록 행. SQL 투영과 일괄 분류·태그 조회를 결합함.
 *
 * @property id 게시글 식별자
 * @property title 저장된 제목
 * @property slug 정규화된 주소
 * @property createdAt UTC 생성 시각
 * @property updatedAt UTC 마지막 수정 시각
 * @property status 초안 또는 출간 상태
 * @property visibility 출간 시 열람 범위
 * @property publishedAt 최초 UTC 출간 시각; 아직 출간한 적 없으면 `null`
 * @property category 현재 분류 참조, 미지정이면 `null`
 * @property tags 입력 순서대로 저장된 정규화 태그
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
    val category: CategoryRefResponse?,
    val tags: List<String>,
)

/** 관리자 페이지 SQL에서 본문·태그를 제외하고 가져온 게시글 기본 행. */
data class AdminPostRow(
    val id: Long,
    val title: String,
    val slug: String,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime,
    val status: PostStatus,
    val visibility: PostVisibility,
    val publishedAt: LocalDateTime?,
    val categoryId: Long?,
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
 * @property categoryId 일괄 분류 메타데이터를 조회할 FK
 */
data class PublishedPostRow(val id: Long, val title: String, val slug: String, val publishedAt: LocalDateTime, val categoryId: Long?)

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
 * 캐시 활성 시 익명 PUBLIC 조회의 권한·현재 본문 버전을 DB에서 먼저 확인하는 본문 없는 행.
 *
 * @property id 키에 사용할 게시글 ID
 * @property title DB 원본 제목
 * @property slug DB 원본 주소
 * @property publishedAt 최초 UTC 출간 시각
 * @property bodySha256 현재 DB 본문의 UTF-8 SHA-256
 * @property categoryId 현재 분류 메타데이터를 조회할 FK
 */
data class PublicPostCacheRow(
    val id: Long,
    val title: String,
    val slug: String,
    val publishedAt: LocalDateTime,
    val bodySha256: String,
    val categoryId: Long?,
)

/**
 * 권한 필터를 거친 공개 목록의 본문 없는 항목.
 *
 * @property id 게시글 ID
 * @property title 제목
 * @property slug 주소
 * @property publishedDate 최초 출간 시각의 Asia/Seoul 날짜
 * @property category 현재 분류 참조, 미지정이면 `null`
 * @property tags 입력 순서대로 저장된 정규화 태그
 */
data class PublicPostSummaryResponse(
    val id: Long,
    val title: String,
    val slug: String,
    val publishedDate: LocalDate,
    val category: CategoryRefResponse?,
    val tags: List<String>,
)

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
 * @property category 읽을 수 있는 글의 분류 참조; 잠금 상태면 `null`
 * @property tags 읽을 수 있는 글의 정규화 태그; 잠금 상태면 빈 배열
 */
data class PublicPostDetailResponse(
    val id: Long,
    val title: String,
    val slug: String,
    val publishedDate: LocalDate,
    val locked: Boolean,
    val body: String?,
    val category: CategoryRefResponse?,
    val tags: List<String>,
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
