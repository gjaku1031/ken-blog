package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.attachment.dto.AttachmentIds
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.project.domain.ProjectMetadata
import io.github.gjaku1031.kenblog.project.dto.ProjectMetadataRequests
import tools.jackson.databind.JsonNode

/** 본문 없이 글 주소·소속·선언을 등록하는 입력. 원고는 별도 Markdown 파일이다. */
data class PostMetadataCreateRequest(
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
    val projectMetadata: ProjectMetadata? = null,
    val attachmentIds: List<Long> = emptyList(),
    val wikiTargets: List<String> = emptyList(),
) {
    companion object {
        /** JSON 스칼라 타입과 본문 필드 부재를 확인한다. */
        fun fromJson(node: JsonNode): PostMetadataCreateRequest {
            if (!node.isObject || node.has("body") || node.has("bodySha256") || node.has("status") ||
                node.has("visibility")) throw InvalidPostRequestException()
            val section = try { PostSection.valueOf(string(node, "section")) }
                catch (_: IllegalArgumentException) { throw InvalidPostRequestException() }
            val tagsNode = node.get("tags")
            val tags = if (tagsNode == null) emptyList() else {
                if (!tagsNode.isArray || tagsNode.size() > 100) throw InvalidPostRequestException()
                (0 until tagsNode.size()).map { index ->
                    val item = tagsNode.get(index)
                    if (!item.isTextual) throw InvalidPostRequestException()
                    item.textValue()
                }
            }
            val project = node.get("projectMetadata")?.let {
                if (it.isNull) null else ProjectMetadataRequests.parse(it, PostVisibility.PUBLIC)
            }
            return PostMetadataCreateRequest(
                string(node, "title"), string(node, "slug"), section,
                optionalString(node, "summary") ?: "", optionalLong(node, "categoryId"), tags,
                optionalLong(node, "projectId"), optionalLong(node, "relatedProjectId"),
                optionalLong(node, "courseId"), optionalInt(node, "documentOrder"),
                optionalInt(node, "chapterOrder"), optionalInt(node, "techSeriesOrder"), project,
                AttachmentIds.parse(node.get("attachmentIds")) ?: emptyList(),
                WikiDeclarations.parse(node.get("wikiTargets")) ?: emptyList(),
            )
        }

        private fun string(node: JsonNode, name: String): String = node.get(name)?.let {
            if (!it.isTextual) throw InvalidPostRequestException()
            it.textValue()
        } ?: throw InvalidPostRequestException()

        private fun optionalString(node: JsonNode, name: String): String? = node.get(name)?.let {
            if (it.isNull) null else if (it.isTextual) it.textValue() else throw InvalidPostRequestException()
        }

        private fun optionalLong(node: JsonNode, name: String): Long? = node.get(name)?.let {
            if (it.isNull) null else if (it.isIntegralNumber && it.canConvertToLong()) it.longValue()
            else throw InvalidPostRequestException()
        }

        private fun optionalInt(node: JsonNode, name: String): Int? = node.get(name)?.let {
            if (it.isNull) null else if (it.isIntegralNumber && it.canConvertToInt()) it.intValue()
            else throw InvalidPostRequestException()
        }
    }
}
