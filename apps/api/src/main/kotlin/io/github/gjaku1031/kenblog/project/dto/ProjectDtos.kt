package io.github.gjaku1031.kenblog.project.dto

import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.project.domain.ProjectEntity
import io.github.gjaku1031.kenblog.project.domain.ProjectStatus
import io.github.gjaku1031.kenblog.project.domain.InvalidProjectRequestException
import io.github.gjaku1031.kenblog.stack.dto.StackBadgeResponse
import io.swagger.v3.oas.annotations.media.Schema
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import tools.jackson.databind.JsonNode

/** 공개 목록 카드에서 읽을 수 있는 프로젝트 메타데이터와 권한별 건수. */
data class ProjectSummaryResponse(
    val id: Long,
    val slug: String,
    val name: String,
    val status: ProjectStatus,
    val startPeriod: String,
    val endPeriod: String?,
    val overview: String,
    val visibility: PostVisibility,
    val documentCount: Long,
    val relatedTechCount: Long,
    val stackBadges: List<StackBadgeResponse> = emptyList(),
)

/** 권한으로 필터한 공개 프로젝트 페이지. */
data class ProjectPageResponse(
    val items: List<ProjectSummaryResponse>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)

/** 잠금 상태에서는 slug·name 외 모든 프로젝트 필드를 null로 보내는 상세 메타데이터. */
data class ProjectPublicInfo(
    val id: Long?,
    val slug: String,
    val name: String,
    val status: ProjectStatus?,
    val startPeriod: String?,
    val endPeriod: String?,
    val overview: String?,
    val visibility: PostVisibility?,
    val documentCount: Long?,
    val relatedTechCount: Long?,
    val stackBadges: List<StackBadgeResponse>? = null,
)

/** 실제 대문 원문과 최초 출간일. 첨부 바이트는 기존 권한 검증 경로만 사용. */
data class ProjectHomeResponse(
    val id: Long,
    val title: String,
    val slug: String,
    val body: String,
    val publishedDate: LocalDate,
    val bodySha256: String,
)

/** 본문 열 없이 공개 프로젝트의 현재 권한으로 읽을 수 있는 문서. */
data class ProjectDocumentRow(
    val id: Long,
    val title: String,
    val slug: String,
    val documentOrder: Int?,
    val publishedAt: LocalDateTime?,
    val visibility: PostVisibility,
) {
    /** @return KST 출간일을 가진 프로젝트 문서 목록 DTO. */
    fun response(): ProjectDocumentResponse = ProjectDocumentResponse(
        id, title, slug, documentOrder ?: 0, publishedAt.kstDate(), visibility, locked = false)
}

/** 프로젝트 상세의 문서 탐색 행. 익명 PRIVATE 문서는 SQL에서 제외됨. */
data class ProjectDocumentResponse(
    val id: Long,
    val title: String,
    val slug: String,
    val order: Int,
    val publishedDate: LocalDate,
    val visibility: PostVisibility,
    val locked: Boolean,
)

/** 본문 없는 관련 Tech SQL 투영. */
data class ProjectRelatedTechRow(
    val id: Long,
    val title: String,
    val slug: String,
    val publishedAt: LocalDateTime?,
    val visibility: PostVisibility,
) {
    /** @return 현재 권한으로 읽을 수 있는 관련 Tech 카드. */
    fun response(): ProjectRelatedTechResponse = ProjectRelatedTechResponse(
        id, title, slug, publishedAt.kstDate(), visibility)
}

/** 관련 Tech의 본문 없는 이동 카드. */
data class ProjectRelatedTechResponse(
    val id: Long,
    val title: String,
    val slug: String,
    val publishedDate: LocalDate,
    val visibility: PostVisibility,
)

/** 공개 대문·문서·처음 다섯 관련 Tech의 현재 권한 응답. */
data class ProjectDetailResponse(
    val locked: Boolean,
    val project: ProjectPublicInfo,
    val home: ProjectHomeResponse?,
    val documents: List<ProjectDocumentResponse>,
    val relatedTech: List<ProjectRelatedTechResponse>,
    val relatedTechCount: Long,
)

/** 관련 Tech의 전체 건수와 실제 페이지. */
data class ProjectRelatedPageResponse(
    val items: List<ProjectRelatedTechResponse>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)

/** 관리자 프로젝트 기본 메타데이터와 대문 식별자·수정 시각. */
data class ProjectAdminInfo(
    val id: Long,
    val slug: String,
    val name: String,
    val status: ProjectStatus,
    val startPeriod: String,
    val endPeriod: String?,
    val overview: String,
    val visibility: PostVisibility,
    val homePostId: Long?,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime,
    val stackBadges: List<StackBadgeResponse> = emptyList(),
)

/** 프로젝트 삭제·문서 순서 관리 화면의 관리자 상세. */
data class ProjectAdminDetailResponse(
    val project: ProjectAdminInfo,
    val home: PostDetailResponse?,
    val documents: List<ProjectAdminDocumentResponse>,
    val relatedTech: List<ProjectRelatedTechResponse>,
)

/** 출간 이전 문서를 포함하는 관리자 문서 관리 행. */
data class ProjectAdminDocumentResponse(
    val id: Long,
    val title: String,
    val slug: String,
    val order: Int,
    val status: PostStatus,
    val visibility: PostVisibility,
)

/** 관리자 프로젝트 메타데이터 페이지. */
data class ProjectAdminPageResponse(
    val items: List<ProjectAdminInfo>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)

/** 전체 문서 ID 순서를 빠짐없이 지정하는 원자적 교체 요청. */
data class ProjectDocumentOrderRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["array"])
    val postIds: List<Long>,
)

/** 문서 순서 JSON의 ID 타입·상한을 강제 변환 없이 확인. */
object ProjectDocumentOrders {
    /** @return 중복 없는 양수 ID 배열; 실제 현재 문서 전체 집합 검사는 서비스에서 수행. */
    fun parse(node: JsonNode): List<Long> {
        val ids = node.get("postIds")
        if (!node.isObject || ids == null || !ids.isArray || ids.size() > 1000) throw InvalidProjectRequestException()
        val result = ArrayList<Long>(ids.size())
        for (index in 0 until ids.size()) {
            val item = ids.get(index)
            if (!item.isIntegralNumber || !item.canConvertToLong() || item.longValue() <= 0) throw InvalidProjectRequestException()
            result.add(item.longValue())
        }
        if (result.size != result.distinct().size) throw InvalidProjectRequestException()
        return result
    }
}

/** @return 현재 프로젝트 행의 관리자 직렬화 값. */
fun ProjectEntity.adminInfo(): ProjectAdminInfo = ProjectAdminInfo(
    id ?: error("Persisted project has no ID"), slug, name, status, startPeriod, endPeriod,
    overview, visibility, homePostId, createdAt, updatedAt)

/** @return UTC 최초 출간 시각의 KST 날짜. */
private fun LocalDateTime?.kstDate(): LocalDate =
    (this ?: error("Published post has no publication time"))
        .atZone(ZoneOffset.UTC).withZoneSameInstant(ZoneId.of("Asia/Seoul")).toLocalDate()
