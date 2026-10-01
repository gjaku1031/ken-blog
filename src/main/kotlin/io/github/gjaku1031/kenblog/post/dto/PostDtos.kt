package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.project.domain.ProjectMetadata
import java.time.LocalDate
import java.time.LocalDateTime

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
    val section: PostSection = PostSection.TECH,
    val projectId: Long? = null,
    val projectSlug: String? = null,
    val relatedProjectId: Long? = null,
    val documentOrder: Int? = null,
    val projectMetadata: ProjectMetadata? = null,
    val courseId: Long? = null,
    val courseSlug: String? = null,
    val chapterOrder: Int? = null,
    val summary: String = "",
    val bodySha256: String = "",
    val techSeriesOrder: Int? = null,
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
    val section: PostSection = PostSection.TECH,
    val projectId: Long? = null,
    val relatedProjectId: Long? = null,
    val courseId: Long? = null,
    val summary: String = "",
    val techSeriesOrder: Int? = null,
    val projectName: String? = null,
    val courseName: String? = null,
    val courseField: String? = null,
    val documentOrder: Int? = null,
    val chapterOrder: Int? = null,
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
    val section: PostSection,
    val projectId: Long?,
    val courseId: Long?,
    val summary: String,
    val techSeriesOrder: Int?,
    val projectName: String?,
    val courseName: String?,
    val courseField: String?,
    val documentOrder: Int?,
    val chapterOrder: Int?,
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
 * PUBLIC 출간 글의 상세. 전체 본문을 반환한다.
 *
 *
 * @property id 게시글 ID
 * @property title 제목 또는 잠금 화면 허용 제목
 * @property slug 주소
 * @property publishedDate 최초 출간 시각의 Asia/Seoul 날짜
 * @property locked 과거 응답 호환용이며 항상 `false`
 * @property body 공개 출간된 원문 본문
 * @property category 분류 참조
 * @property tags 정규화 태그
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
    val section: PostSection = PostSection.TECH,
    val projectSlug: String? = null,
    val relatedProject: RelatedProjectResponse? = null,
    val courseSlug: String? = null,
    val bodySha256: String? = null,
    val series: PostSeriesResponse? = null,
    val summary: String = "",
    val techSeriesOrder: Int? = null,
)

/** 소분류 Tech 또는 과목 회차의 권한별 시리즈 이동 행. */
data class PostSeriesItem(val id: Long, val slug: String, val title: String, val order: Int)

/** 시리즈가 2편 이상일 때만 제공하는 전체 이동 목록과 1기반 현재 위치. */
data class PostSeriesResponse(val items: List<PostSeriesItem>, val position: Int)

/** Tech 소분류 시리즈의 본문 없는 SQL 행. */
data class PostSeriesRow(val id: Long, val slug: String, val title: String)

/** TECH 글에서 현재 열람 가능한 관련 프로젝트의 최소 이동 정보. */
data class RelatedProjectResponse(val id: Long, val slug: String, val name: String)

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
