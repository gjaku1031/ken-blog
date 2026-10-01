package io.github.gjaku1031.kenblog.mcp.dto

import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.project.domain.ProjectStatus
import io.github.gjaku1031.kenblog.note.domain.CourseStatus

/** Markdown 본문을 받지 않는 새 글 메타데이터 등록 입력. */
data class McpPostMetadataInput(
    val title: String,
    val slug: String,
    val section: PostSection,
    val summary: String = "",
    val categoryId: Long? = null,
    val tags: List<String> = emptyList(),
    val projectId: Long? = null,
    val relatedProjectId: Long? = null,
    val courseId: Long? = null,
    val documentOrder: Int? = null,
    val chapterOrder: Int? = null,
    val techSeriesOrder: Int? = null,
    val projectMetadata: McpProjectMetadataInput? = null,
    val attachmentIds: List<Long> = emptyList(),
    val wikiTargets: List<String> = emptyList(),
)

/** 새 프로젝트 대문에 필요한 기간·개요·상태·뱃지 메타데이터. */
data class McpProjectMetadataInput(
    val status: ProjectStatus,
    val startPeriod: String,
    val endPeriod: String? = null,
    val overview: String,
    val stackBadgeNames: List<String> = emptyList(),
)

/** 이미지 바이트만 인라인으로 받고 서버 경로·URL은 받지 않는 업로드 입력. */
data class McpImageInput(val filename: String, val mimeType: String, val base64: String)

/** 프로젝트의 사용 중인 로고까지 연결된 기술 뱃지 등록 입력. */
data class McpStackBadgeInput(val name: String, val image: McpImageInput)

/** Notes 과목의 전체 교체 입력. */
data class McpCourseInput(val field: String, val name: String, val description: String,
    val status: CourseStatus)
