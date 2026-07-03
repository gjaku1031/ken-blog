package io.github.gjaku1031.kenblog.draft.dto

import io.github.gjaku1031.kenblog.attachment.dto.AttachmentIds
import io.github.gjaku1031.kenblog.draft.domain.EditorDraftEntity
import io.github.gjaku1031.kenblog.draft.domain.EditorDraftValues
import io.github.gjaku1031.kenblog.draft.domain.InvalidEditorDraftRequestException
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.TagNames
import io.github.gjaku1031.kenblog.post.dto.WikiDeclarations
import io.swagger.v3.oas.annotations.media.Schema
import java.time.LocalDateTime
import java.time.format.DateTimeParseException
import tools.jackson.databind.JsonNode

/**
 * 새 글이면 두 원본 필드를 명시적으로 null로, 기존 글이면 양수 ID와 UTC 기준 시각으로 받는 생성 계약.
 * 실제 JSON 파싱은 [EditorDraftRequests.create]가 타입 강제를 거부함.
 */
data class EditorDraftCreateRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["integer", "null"], format = "int64")
    val postId: Long?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string", "null"], format = "date-time")
    val baseUpdatedAt: LocalDateTime?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"])
    val title: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"])
    val slug: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"])
    val body: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["integer", "null"], format = "int64")
    val categoryId: Long?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["array"])
    val tags: List<String>,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"], allowableValues = ["PUBLIC", "PRIVATE"])
    val visibility: PostVisibility,
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED, types = ["array", "null"], description = "선택적 READY 첨부 ID 최대 100개; 원본 편집 생성 시 생략하면 상속")
    val attachmentIds: List<Long>?,
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED, types = ["array", "null"], description = "선택적 위키 대상 제목 최대 128개")
    val wikiTargets: List<String>?,
) {
    /** @return 정규화·상한 검사를 마친 내용 값. */
    fun values(): EditorDraftValues = EditorDraftValues(title, slug, body, categoryId, tags, visibility)
}

/** revision 조건과 전체 편집 내용을 받되 원본 ID·기준 시각은 바꾸지 않는 PUT 계약. */
data class EditorDraftUpdateRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["integer"], format = "int64", minimum = "0")
    val revision: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"])
    val title: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"])
    val slug: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"])
    val body: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["integer", "null"], format = "int64")
    val categoryId: Long?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["array"])
    val tags: List<String>,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"], allowableValues = ["PUBLIC", "PRIVATE"])
    val visibility: PostVisibility,
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED, types = ["array", "null"], description = "선택적 READY 첨부 ID 최대 100개; 생략하면 기존 연결 유지")
    val attachmentIds: List<Long>?,
    @field:Schema(requiredMode = Schema.RequiredMode.NOT_REQUIRED, types = ["array", "null"], description = "선택적 위키 대상 제목 최대 128개")
    val wikiTargets: List<String>?,
) {
    /** @return 검증한 전체 교체 내용 값. */
    fun values(): EditorDraftValues = EditorDraftValues(title, slug, body, categoryId, tags, visibility)
}

/** 현재 편집본 revision만 받는 원자적 출간 계약. */
data class EditorDraftPublishRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["integer"], format = "int64", minimum = "0")
    val revision: Long,
)

/** 관리 엔티티를 미리 적재하지 않고 잠금 순서에 필요한 FK 스냅샷만 읽는 행. */
data class EditorDraftLockHint(val postId: Long?, val categoryId: Long?)

/** 관리자 편집본의 모든 저장 필드와 revision을 보이는 상세 응답. */
data class EditorDraftDetailResponse(
    val id: Long,
    val revision: Long,
    val postId: Long?,
    val baseUpdatedAt: LocalDateTime?,
    val title: String,
    val slug: String,
    val body: String,
    val categoryId: Long?,
    val tags: List<String>,
    val visibility: PostVisibility,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime,
    val attachmentIds: List<Long>,
    val wikiTargets: List<String>,
)

/** 본문 열을 읽지 않는 관리자 편집본 목록의 한 행. */
data class EditorDraftSummaryRow(
    val id: Long,
    val revision: Long,
    val postId: Long?,
    val baseUpdatedAt: LocalDateTime?,
    val title: String,
    val slug: String,
    val categoryId: Long?,
    val tagsSnapshot: String,
    val visibility: PostVisibility,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime,
) {
    /** @return 직렬화 문자열 대신 태그 배열을 포함한 공개 목록 행. */
    fun response(): EditorDraftSummaryResponse = EditorDraftSummaryResponse(id, revision, postId, baseUpdatedAt,
        title, slug, categoryId, if (tagsSnapshot.isEmpty()) emptyList() else tagsSnapshot.split('\u001f'),
        visibility, createdAt, updatedAt)
}

/** 본문을 제외한 관리자 편집본 목록 행. */
data class EditorDraftSummaryResponse(
    val id: Long,
    val revision: Long,
    val postId: Long?,
    val baseUpdatedAt: LocalDateTime?,
    val title: String,
    val slug: String,
    val categoryId: Long?,
    val tags: List<String>,
    val visibility: PostVisibility,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime,
)

/** 본문 없는 한 페이지와 같은 조건의 전체 건수. */
data class EditorDraftPageResponse(
    val items: List<EditorDraftSummaryResponse>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)

/** 엔티티 내부 직렬화 방식은 응답에 노출하지 않고 태그 배열로 변환. */
fun EditorDraftEntity.response(attachmentIds: List<Long>, wikiTargets: List<String>): EditorDraftDetailResponse = EditorDraftDetailResponse(
    id ?: error("Persisted editor draft has no ID"), revision, postId, baseUpdatedAt,
    title, slug, body, categoryId, tags(), visibility, createdAt, updatedAt, attachmentIds, wikiTargets,
)

/** Jackson 문자열·숫자 강제 변환 전에 실제 JSON 노드 타입과 입력 상한을 확인. */
object EditorDraftRequests {
    /** @return 모든 필드를 명시한 새 글 또는 원본 편집 생성 요청. */
    fun create(node: JsonNode): EditorDraftCreateRequest {
        requireObject(node)
        val postId = nullableId(node, "postId")
        val base = nullableTime(node, "baseUpdatedAt")
        if ((postId == null) != (base == null)) throw InvalidEditorDraftRequestException()
        val values = values(node)
        return EditorDraftCreateRequest(postId, base, values.title, values.slug, values.body,
            values.categoryId, values.tags, values.visibility, AttachmentIds.parse(node.get("attachmentIds")),
            WikiDeclarations.parse(node.get("wikiTargets")))
    }

    /** @return revision과 전체 내용이 있는 갱신 요청. */
    fun update(node: JsonNode): EditorDraftUpdateRequest {
        requireObject(node)
        val revision = revision(node)
        val values = values(node)
        return EditorDraftUpdateRequest(revision, values.title, values.slug, values.body,
            values.categoryId, values.tags, values.visibility, AttachmentIds.parse(node.get("attachmentIds")),
            WikiDeclarations.parse(node.get("wikiTargets")))
    }

    /** @return 현재 화면의 0 이상 revision을 가진 출간 요청. */
    fun publish(node: JsonNode): EditorDraftPublishRequest {
        requireObject(node)
        return EditorDraftPublishRequest(revision(node))
    }

    /** @return 스칼라·태그 타입과 저장 상한을 검증하고 태그만 정규화한 내용. */
    private fun values(node: JsonNode): EditorDraftValues {
        val title = string(node, "title")
        val slug = string(node, "slug")
        val body = string(node, "body")
        if (title.codePointCount(0, title.length) > 200 || slug.codePointCount(0, slug.length) > 160 ||
            body.toByteArray(Charsets.UTF_8).size > 1024 * 1024) throw InvalidEditorDraftRequestException()
        val categoryId = nullableId(node, "categoryId")
        val tagsNode = field(node, "tags")
        if (!tagsNode.isArray) throw InvalidEditorDraftRequestException()
        val rawTags = ArrayList<String>(tagsNode.size())
        for (index in 0 until tagsNode.size()) {
            val tag = tagsNode.get(index)
            if (!tag.isTextual) throw InvalidEditorDraftRequestException()
            rawTags.add(tag.textValue())
        }
        val tags = try { TagNames.normalizeAll(rawTags) }
            catch (ex: InvalidPostRequestException) { throw InvalidEditorDraftRequestException() }
        val visibility = when (string(node, "visibility")) {
            "PUBLIC" -> PostVisibility.PUBLIC
            "PRIVATE" -> PostVisibility.PRIVATE
            else -> throw InvalidEditorDraftRequestException()
        }
        return EditorDraftValues(title, slug, body, categoryId, tags, visibility)
    }

    /** @return 객체가 아닌 본문을 400으로 거부. */
    private fun requireObject(node: JsonNode) { if (!node.isObject) throw InvalidEditorDraftRequestException() }

    /** @return 누락·null과 실제 JSON 값을 구분한 필수 필드. */
    private fun field(node: JsonNode, name: String): JsonNode =
        if (node.has(name)) node.get(name) else throw InvalidEditorDraftRequestException()

    /** @return 비문자열 입력을 거부한 필수 문자열. */
    private fun string(node: JsonNode, name: String): String = field(node, name).let {
        if (!it.isTextual) throw InvalidEditorDraftRequestException()
        it.textValue()
    }

    /** @return 명시적 null 또는 양수 정수 ID. */
    private fun nullableId(node: JsonNode, name: String): Long? {
        val value = field(node, name)
        if (value.isNull) return null
        if (!value.isIntegralNumber || !value.canConvertToLong() || value.longValue() <= 0) throw InvalidEditorDraftRequestException()
        return value.longValue()
    }

    /** @return 명시적 null 또는 ISO UTC LocalDateTime 기준 시각. */
    private fun nullableTime(node: JsonNode, name: String): LocalDateTime? {
        val value = field(node, name)
        if (value.isNull) return null
        if (!value.isTextual) throw InvalidEditorDraftRequestException()
        return try { LocalDateTime.parse(value.textValue()) }
            catch (ex: DateTimeParseException) { throw InvalidEditorDraftRequestException() }
    }

    /** @return 누락·소수·문자열을 거부한 0 이상 64비트 revision. */
    private fun revision(node: JsonNode): Long {
        val value = field(node, "revision")
        if (!value.isIntegralNumber || !value.canConvertToLong() || value.longValue() < 0) throw InvalidEditorDraftRequestException()
        return value.longValue()
    }
}
