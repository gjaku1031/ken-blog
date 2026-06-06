package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.swagger.v3.oas.annotations.media.Schema
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
 * 관리자 상세 조회의 초안 내용. [PostEntity] 자체를 JSON으로 노출하지 않음.
 *
 * @property id 게시글 식별자
 * @property title 저장된 제목
 * @property slug 정규화된 주소
 * @property body 원문 그대로의 본문
 * @property createdAt UTC 생성 시각
 * @property updatedAt UTC 마지막 수정 시각
 */
data class PostDetailResponse(
    val id: Long,
    val title: String,
    val slug: String,
    val body: String,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime,
)

/**
 * 본문 열을 제외한 관리자 목록 행. [io.github.gjaku1031.kenblog.post.repository.PostRepository.findAdminSummaries]가 직접 생성함.
 *
 * @property id 게시글 식별자
 * @property title 저장된 제목
 * @property slug 정규화된 주소
 * @property createdAt UTC 생성 시각
 * @property updatedAt UTC 마지막 수정 시각
 */
data class PostSummaryResponse(
    val id: Long,
    val title: String,
    val slug: String,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime,
)

/**
 * 관리자 초안 목록과 페이지 정보. Spring Data의 Page 구현체는 HTTP에 노출하지 않음.
 *
 * @property items 본문 없는 목록 행
 * @property page 0 기반 현재 페이지
 * @property size 요청한 페이지 크기
 * @property totalElements 전체 초안 수
 * @property totalPages 전체 페이지 수
 */
data class PostPageResponse(
    val items: List<PostSummaryResponse>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)
