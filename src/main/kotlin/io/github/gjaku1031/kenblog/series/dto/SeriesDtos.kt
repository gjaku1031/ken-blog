package io.github.gjaku1031.kenblog.series.dto

import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.PostSeriesItem
import io.github.gjaku1031.kenblog.series.domain.*
import io.github.gjaku1031.kenblog.stack.dto.StackBadgeResponse
import java.time.LocalDateTime
import tools.jackson.databind.JsonNode

/** 목록과 관리자 편집에 사용하는 시리즈 속성. cover는 첫 출간 문서에서 계산. */
data class SeriesResponse(
    val id: Long, val slug: String, val name: String, val kind: SeriesKind,
    val description: String, val visibility: PostVisibility,
    val projectStatus: ProjectStatus?, val startPeriod: String?, val endPeriod: String?,
    val sortOrder: Long, val updatedAt: LocalDateTime,
    val cover: PostSeriesItem?, val postCount: Int, val stackBadges: List<StackBadgeResponse>,
)
/** 본문 없는 시리즈 메타데이터와 같은 규칙으로 정렬한 글 목록. */
data class SeriesDetailResponse(val series: SeriesResponse, val posts: List<SeriesPostResponse>)
/** 관리자에게는 미출간 문서도 포함하며 공개 상세에는 출간 문서만 포함. */
data class SeriesPostResponse(val id: Long, val title: String, val slug: String,
    val order: Int?, val published: Boolean)
/** 변경할 시리즈 속성. 종류와 주소 변경은 허용하지 않음. */
data class SeriesMetadataRequest(
    val name: String, val description: String = "", val projectStatus: ProjectStatus? = null,
    val startPeriod: String? = null, val endPeriod: String? = null,
    val stackBadgeNames: List<String> = emptyList(), val baseUpdatedAt: LocalDateTime? = null,
)
/** 시리즈 생성은 문서 생성과 독립적이며 첫 출간 전에는 공개 목록에 나오지 않음. */
data class SeriesCreateRequest(val slug: String? = null, val kind: SeriesKind, val metadata: SeriesMetadataRequest)

/** JSON 타입·문자열·기간·종류별 메타데이터를 검사. */
object SeriesRequests {
    fun metadata(node: JsonNode): SeriesMetadataRequest {
        val allowed = setOf("name", "description", "projectStatus", "startPeriod", "endPeriod", "stackBadgeNames", "baseUpdatedAt")
        if (!node.isObject || node.properties().any { it.key !in allowed }) throw InvalidSeriesRequestException()
        val status = optionalText(node, "projectStatus")?.let { value ->
            ProjectStatus.entries.firstOrNull { it.name == value } ?: throw InvalidSeriesRequestException()
        }
        val badges = node.get("stackBadgeNames")?.let {
            if (!it.isArray || it.size() > 30) throw InvalidSeriesRequestException()
            (0 until it.size()).map { index ->
                if (!it[index].isTextual) throw InvalidSeriesRequestException()
                it[index].textValue()
            }
        } ?: emptyList()
        val base = optionalText(node, "baseUpdatedAt")?.let {
            try { LocalDateTime.parse(it) } catch (_: java.time.format.DateTimeParseException) { throw InvalidSeriesRequestException() }
        }
        return SeriesMetadataRequest(optionalText(node, "name") ?: throw InvalidSeriesRequestException(),
            optionalText(node, "description") ?: "", status, optionalText(node, "startPeriod"),
            optionalText(node, "endPeriod"), badges, base)
    }
    fun create(node: JsonNode): SeriesCreateRequest {
        val allowed = setOf("slug", "kind", "metadata")
        if (!node.isObject || node.properties().any { it.key !in allowed } || !node.path("kind").isTextual || !node.has("metadata"))
            throw InvalidSeriesRequestException()
        val kind = SeriesKind.entries.firstOrNull { it.name == node.get("kind").textValue() }
            ?: throw InvalidSeriesRequestException()
        return SeriesCreateRequest(optionalText(node, "slug"), kind, metadata(node.get("metadata")))
    }
    fun validate(kind: SeriesKind, input: SeriesMetadataRequest): SeriesMetadataRequest {
        val name = input.name.trim(); val description = input.description.trim()
        if (name.isBlank() || name.codePointCount(0, name.length) > 200 || description.codePointCount(0, description.length) > 1000 ||
            name.any(Char::isISOControl) || description.any { Character.isISOControl(it) && it != '\n' && it != '\t' })
            throw InvalidSeriesRequestException()
        if (kind == SeriesKind.TECH) {
            if (input.projectStatus != null || input.startPeriod != null || input.endPeriod != null || input.stackBadgeNames.isNotEmpty())
                throw InvalidSeriesRequestException()
        } else {
            val start = input.startPeriod ?: throw InvalidSeriesRequestException()
            if (input.projectStatus == null || !PERIOD.matches(start) || start.startsWith("0000") ||
                input.endPeriod?.let { !PERIOD.matches(it) || it.startsWith("0000") || it < start } == true)
                throw InvalidSeriesRequestException()
        }
        return input.copy(name = name, description = description)
    }
    private fun optionalText(node: JsonNode, name: String): String? = node.get(name)?.let {
        if (it.isNull) null else if (it.isTextual) it.textValue() else throw InvalidSeriesRequestException()
    }
    private val PERIOD = Regex("[0-9]{4}\\.(0[1-9]|1[0-2])")
}
