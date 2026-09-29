package io.github.gjaku1031.kenblog.mcp.dto

import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.project.domain.ProjectStatus
import io.github.gjaku1031.kenblog.note.domain.CourseStatus

/** MCP 쓰기 스키마에서 허용하는 유일한 공개 상태. */
enum class McpPublicVisibility { PUBLIC;
    /** 기존 저장 도메인의 공개 값으로 변환. */
    fun stored(): PostVisibility = PostVisibility.PUBLIC
}

/** 새 편집본과 수정 편집본의 전체 교체 입력. null 원본 ID는 새 글을 의미. */
data class McpDraftInput(
    val title: String,
    val body: String,
    val section: PostSection,
    val visibility: McpPublicVisibility = McpPublicVisibility.PUBLIC,
    val attachmentIds: List<Long>,
    val wikiTargets: List<String>,
    val categoryId: Long? = null,
    val tags: List<String> = emptyList(),
    val projectId: Long? = null,
    val relatedProjectId: Long? = null,
    val courseId: Long? = null,
    val documentOrder: Int? = null,
    val chapterOrder: Int? = null,
    val projectMetadata: McpProjectMetadataInput? = null,
    val summary: String = "",
    val techSeriesOrder: Int? = null,
    val postId: Long? = null,
    val baseUpdatedAt: String? = null,
)

/** PROJECT_HOME 출간에 필요한 프로젝트 속성과 기존 프로젝트 수정 기준 시각. */
data class McpProjectMetadataInput(
    val status: ProjectStatus,
    val startPeriod: String,
    val endPeriod: String? = null,
    val overview: String,
    val stackBadgeNames: List<String> = emptyList(),
    val baseProjectUpdatedAt: String? = null,
)

/** 현재 revision의 편집본을 전체 교체하는 요청. */
data class McpDraftUpdateInput(val revision: Long, val content: McpDraftInput)

/** 이미지 바이트만 인라인으로 받고 서버 경로·URL은 받지 않는 업로드 입력. */
data class McpImageInput(val filename: String, val mimeType: String, val base64: String)

/** 프로젝트의 사용 중인 로고까지 연결된 기술 뱃지 등록 입력. */
data class McpStackBadgeInput(val name: String, val image: McpImageInput)

/** Notes 과목의 전체 교체 입력. */
data class McpCourseInput(val field: String, val name: String, val description: String,
    val status: CourseStatus)

/** 본문 선언 분석에서 자동 추출의 신뢰도와 함께 반환하는 편집본 응답. */
data class McpDraftWriteResult<T>(val content: T, val declarationDiagnostics: List<String>)
