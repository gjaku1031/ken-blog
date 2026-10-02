package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.attachment.dto.AttachmentIds
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import tools.jackson.databind.JsonNode

/** 본문 없이 글 주소·시리즈·분류·첨부 선언만 등록. 구획은 시리즈에서 결정. */
data class PostMetadataCreateRequest(
    val title: String, val slug: String? = null, val summary: String = "",
    val categoryId: Long? = null, val tags: List<String> = emptyList(),
    val seriesId: Long? = null, val order: Int? = null, val relatedSeriesId: Long? = null,
    val attachmentIds: List<Long> = emptyList(), val wikiTargets: List<String> = emptyList(),
) {
    companion object {
        /** 본문·이전 대문/회차 필드와 알 수 없는 입력을 거부. */
        fun fromJson(node: JsonNode): PostMetadataCreateRequest {
            val allowed = setOf("title", "slug", "summary", "categoryId", "tags", "seriesId", "order",
                "relatedSeriesId", "attachmentIds", "wikiTargets")
            if (!node.isObject || node.properties().any { it.key !in allowed }) throw InvalidPostRequestException()
            val tags = node.get("tags")?.let {
                if (!it.isArray || it.size() > 100) throw InvalidPostRequestException()
                (0 until it.size()).map { index ->
                    if (!it[index].isTextual) throw InvalidPostRequestException()
                    it[index].textValue()
                }
            } ?: emptyList()
            return PostMetadataCreateRequest(requiredString(node, "title"), optionalString(node, "slug"),
                optionalString(node, "summary") ?: "", optionalLong(node, "categoryId"), tags,
                optionalLong(node, "seriesId"), optionalInt(node, "order"), optionalLong(node, "relatedSeriesId"),
                AttachmentIds.parse(node.get("attachmentIds")) ?: emptyList(),
                WikiDeclarations.parse(node.get("wikiTargets")) ?: emptyList())
        }
        private fun requiredString(node: JsonNode, name: String): String = node.get(name)?.takeIf { it.isTextual }
            ?.textValue() ?: throw InvalidPostRequestException()
        private fun optionalString(node: JsonNode, name: String): String? = node.get(name)?.let {
            if (it.isNull) null else if (it.isTextual) it.textValue() else throw InvalidPostRequestException()
        }
        fun optionalLong(node: JsonNode, name: String): Long? = node.get(name)?.let {
            if (it.isNull) null else if (it.isIntegralNumber && it.canConvertToLong()) it.longValue()
            else throw InvalidPostRequestException()
        }
        fun optionalInt(node: JsonNode, name: String): Int? = node.get(name)?.let {
            if (it.isNull) null else if (it.isIntegralNumber && it.canConvertToInt()) it.intValue()
            else throw InvalidPostRequestException()
        }
    }
}
