package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.series.domain.SeriesKind
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * 시리즈의 최소 이동 정보
 * 종류는 시리즈 소속으로 결정
 */
data class SeriesRef(
    /**
     * ID
     */
    val id: Long,
    /**
     * 공개 주소 식별자
     */
    val slug: String,
    /**
     * 이름
     */
    val name: String,
    /**
     * 시리즈 종류
     */
    val kind: SeriesKind
)

/**
 * 본문·본문 해시를 제외한 관리자 메타데이터와 선언 관계
 */
data class PostDetailResponse(
    /**
     * ID
     */
    val id: Long,
    /**
     * 제목
     */
    val title: String,
    /**
     * 공개 주소 식별자
     */
    val slug: String,
    /**
     * 생성 시각
     */
    val createdAt: LocalDateTime,
    /**
     * 수정 시각
     */
    val updatedAt: LocalDateTime,
    /**
     * 출간 상태
     */
    val status: PostStatus,
    /**
     * 공개 범위
     */
    val visibility: PostVisibility,
    /**
     * 최초 출간 시각
     */
    val publishedAt: LocalDateTime?,
    /**
     * 분류
     */
    val category: CategoryRefResponse?,
    /**
     * 태그 목록
     */
    val tags: List<String>,
    /**
     * 첨부 ID 목록
     */
    val attachmentIds: List<Long>,
    /**
     * 위키 대상 제목 목록
     */
    val wikiTargets: List<String>,
    /**
     * 시리즈
     */
    val series: SeriesRef?,
    /**
     * 시리즈 내 정렬 순서
     */
    val seriesOrder: Int?,
    /**
     * 관련 프로젝트 시리즈 ID
     */
    val relatedSeriesId: Long?,
    /**
     * 요약
     */
    val summary: String = "",
) {
    /**
     * 탐색 구획
     */
    val section: SeriesKind
        /**
         * 시리즈 종류 반환, 소속이 없으면 TECH
         */
        get() = series?.kind ?: SeriesKind.TECH
}

/**
 * 본문 없는 관리자 목록
 */
data class PostSummaryResponse(
    /**
     * ID
     */
    val id: Long,
    /**
     * 제목
     */
    val title: String,
    /**
     * 공개 주소 식별자
     */
    val slug: String,
    /**
     * 생성 시각
     */
    val createdAt: LocalDateTime,
    /**
     * 수정 시각
     */
    val updatedAt: LocalDateTime,
    /**
     * 출간 상태
     */
    val status: PostStatus,
    /**
     * 공개 범위
     */
    val visibility: PostVisibility,
    /**
     * 최초 출간 시각
     */
    val publishedAt: LocalDateTime?,
    /**
     * 분류
     */
    val category: CategoryRefResponse?,
    /**
     * 태그 목록
     */
    val tags: List<String>,
    /**
     * 시리즈
     */
    val series: SeriesRef?,
    /**
     * 시리즈 내 정렬 순서
     */
    val seriesOrder: Int?,
    /**
     * 요약
     */
    val summary: String,
    /**
     * 관련 프로젝트 시리즈 ID
     */
    val relatedSeriesId: Long?,
) {
    /**
     * 탐색 구획
     */
    val section: SeriesKind
        /**
         * 시리즈 종류 반환, 소속이 없으면 TECH
         */
        get() = series?.kind ?: SeriesKind.TECH
}

/**
 * 관리자 목록의 페이지 정보
 */
data class PostPageResponse(
    /**
     * 조회 결과 목록
     */
    val items: List<PostSummaryResponse>,
    /**
     * 0 기반 페이지 번호
     */
    val page: Int,
    /**
     * 페이지 크기
     */
    val size: Int,
    /**
     * 전체 결과 수
     */
    val totalElements: Long,
    /**
     * 전체 페이지 수
     */
    val totalPages: Int
)

/**
 * 첫 출간 글과 같은 공통 문서 이동 정보
 * order는 시리즈 내 1기반 표시 위치
 */
data class PostSeriesItem(
    /**
     * ID
     */
    val id: Long,
    /**
     * 공개 주소 식별자
     */
    val slug: String,
    /**
     * 제목
     */
    val title: String,
    /**
     * 표시 순서
     */
    val order: Int
)
/**
 * 단일 문서도 포함하는 시리즈 이름·목록·현재 위치
 */
data class PostSeriesResponse(
    /**
     * ID
     */
    val id: Long,
    /**
     * 공개 주소 식별자
     */
    val slug: String,
    /**
     * 이름
     */
    val name: String,
    /**
     * 시리즈 종류
     */
    val kind: SeriesKind,
    /**
     * 조회 결과 목록
     */
    val items: List<PostSeriesItem>,
    /**
     * 입력 순서의 0 기반 위치
     */
    val position: Int
)

/**
 * Pages 생성용 메타데이터
 * 본문은 Git checkout에서만 주입
 */
data class PublicPostDetailResponse(
    /**
     * ID
     */
    val id: Long,
    /**
     * 제목
     */
    val title: String,
    /**
     * 공개 주소 식별자
     */
    val slug: String,
    /**
     * 요약
     */
    val summary: String,
    /**
     * 한국 시간 기준 출간 날짜
     */
    val publishedDate: LocalDate,
    /**
     * 탐색 구획
     */
    val section: SeriesKind,
    /**
     * 분류
     */
    val category: CategoryRefResponse?,
    /**
     * 태그 목록
     */
    val tags: List<String>,
    /**
     * 시리즈
     */
    val series: PostSeriesResponse?,
    /**
     * 관련 프로젝트 시리즈
     */
    val relatedSeries: SeriesRef?,
    /**
     * 이전 공개 경로
     */
    val legacyPath: String?,
    /**
     * 최초 출간 시각
     */
    val publishedAt: LocalDateTime? = null,
)
