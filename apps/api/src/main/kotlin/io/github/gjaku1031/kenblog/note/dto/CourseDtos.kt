package io.github.gjaku1031.kenblog.note.dto

import io.github.gjaku1031.kenblog.note.domain.CourseEntity
import io.github.gjaku1031.kenblog.note.domain.CourseStatus
import io.github.gjaku1031.kenblog.note.domain.InvalidCourseRequestException
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import java.time.LocalDate
import java.time.LocalDateTime
import java.util.Locale
import tools.jackson.databind.JsonNode

/** 과목 등록·전체 수정에 필요한 값. */
data class CourseWriteRequest(val slug: String, val field: String, val name: String,
    val description: String, val status: CourseStatus)

/** [CourseWriteRequest]를 타입 강제 변환 없이 읽는 입력 경계. */
object CourseRequests {
    /** @return 필수 문자열·상태와 상한을 확인한 과목 값. */
    fun write(node: JsonNode): CourseWriteRequest {
        if (!node.isObject) throw InvalidCourseRequestException()
        val slug = string(node, "slug").trim().lowercase(Locale.ROOT)
        val field = string(node, "field").trim()
        val name = string(node, "name").trim()
        val description = string(node, "description").trim()
        val status = when (string(node, "status")) {
            "IN_PROGRESS" -> CourseStatus.IN_PROGRESS
            "COMPLETED" -> CourseStatus.COMPLETED
            else -> throw InvalidCourseRequestException()
        }
        if (slug.length !in 1..160 || !SLUG.matches(slug) || field.isBlank() ||
            field.codePointCount(0, field.length) > 100 || name.isBlank() || description.isBlank() ||
            name.codePointCount(0, name.length) > 200 || description.codePointCount(0, description.length) > 500 ||
            listOf(field, name, description).any { value -> value.any { Character.isISOControl(it) } })
            throw InvalidCourseRequestException()
        return CourseWriteRequest(slug, field, name, description, status)
    }

    /** @return 누락·null·숫자를 거부한 필수 문자열. */
    private fun string(node: JsonNode, name: String): String = node.get(name)?.let {
        if (!it.isTextual) throw InvalidCourseRequestException()
        it.textValue()
    } ?: throw InvalidCourseRequestException()

    /** @return 양수 ID 전체 순열. */
    fun order(node: JsonNode): List<Long> {
        val items = node.get("postIds")
        if (!node.isObject || items == null || !items.isArray || items.size() > 1000) throw InvalidCourseRequestException()
        val ids = (0 until items.size()).map { index ->
            val value = items.get(index)
            if (!value.isIntegralNumber || !value.canConvertToLong() || value.longValue() <= 0)
                throw InvalidCourseRequestException()
            value.longValue()
        }
        if (ids.distinct().size != ids.size) throw InvalidCourseRequestException()
        return ids
    }

    private val SLUG = Regex("[a-z0-9]+(?:-[a-z0-9]+)*")
}

/** 공개 과목 카드와 과목 소개 공통 필드. */
data class CourseSummaryResponse(val id: Long, val slug: String, val field: String, val name: String,
    val description: String, val status: CourseStatus, val chapterCount: Int, val latestPublishedDate: LocalDate?)

/** 분야 순서가 과목 생성 순서인 Notes 목록. */
data class NotesListResponse(val items: List<CourseSummaryResponse>)

/** 관리자 수정 시각을 포함하는 과목 정보. */
data class CourseAdminResponse(val id: Long, val slug: String, val field: String, val name: String,
    val description: String, val status: CourseStatus, val createdAt: LocalDateTime, val updatedAt: LocalDateTime)

/** [ChapterRow]에서 본문 없이 권한별 표시 번호와 저장된 회차 요약을 부여한 탐색 행. */
data class ChapterSummaryResponse(val id: Long, val title: String, val slug: String, val position: Int,
    val publishedDate: LocalDate, val visibility: PostVisibility, val summary: String?, val locked: Boolean = false)

/** [ChapterSummaryResponse]의 목록·사이드바에서 본문을 읽지 않는 출간 회차 SQL 행. */
data class ChapterRow(val id: Long, val title: String, val slug: String, val chapterOrder: Int,
    val publishedAt: LocalDateTime, val visibility: PostVisibility, val summary: String)

/** 과목 소개와 현재 역할로 읽을 수 있는 회차 목록. */
data class CourseDetailResponse(val course: CourseSummaryResponse, val chapters: List<ChapterSummaryResponse>)

/** 기존 글 읽기 구성과 맞춘 Notes 본문. */
data class ChapterDetailResponse(val id: Long, val title: String, val slug: String, val body: String?,
    val publishedDate: LocalDate, val locked: Boolean, val section: String = "NOTE_CHAPTER",
    val courseSlug: String, val category: Nothing? = null, val tags: List<String> = emptyList(),
    val bodySha256: String? = null)

/** 현재 회차와 이전·다음 탐색에 사용할 권한별 번호. */
data class CourseChapterResponse(val course: CourseSummaryResponse, val chapter: ChapterDetailResponse,
    val chapters: List<ChapterSummaryResponse>, val position: Int, val total: Int)

/** 관리자 과목의 비출간 회차와 저장 순서. */
data class AdminChapterResponse(val id: Long, val title: String, val slug: String, val order: Int,
    val status: PostStatus, val visibility: PostVisibility)

/** 과목 수정·회차 순서 관리에 사용할 관리자 상세. */
data class CourseAdminDetailResponse(val course: CourseAdminResponse, val chapters: List<AdminChapterResponse>)

/** @return 저장된 [CourseEntity]의 관리자 값. */
fun CourseEntity.adminResponse(): CourseAdminResponse = CourseAdminResponse(id!!, slug, field, name,
    description, status, createdAt, updatedAt)
