package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import tools.jackson.databind.JsonNode

/**
 * 본문·주소·선언 관계를 제외한 원자적 편집 요청의 엄격한 JSON 경계
 */
internal object PostEditRequest {
    /**
     * 기준 버전 누락·강제 변환·음수·브라우저 정수 범위 초과 거부
     */
    fun version(node: JsonNode): Long {
        val value = node.get("baseVersion") ?: throw InvalidPostRequestException()
        if (!value.isIntegralNumber || !value.canConvertToLong() || value.longValue() !in 0..9_007_199_254_740_991L)
            throw InvalidPostRequestException()
        return value.longValue()
    }

    /**
     * 모든 편집 키를 필수로 받아 부분 저장과 알 수 없는 필드를 거부
     */
    fun metadata(node: JsonNode): PostMetadataCreateRequest {
        val keys = setOf("baseVersion", "title", "summary", "categoryId", "tags", "seriesId", "order", "relatedSeriesId")
        if (!node.isObject || node.properties().map { it.key }.toSet() != keys ||
            !node.path("title").isString || !node.path("summary").isString) throw InvalidPostRequestException()
        version(node)
        val taxonomy = PostTaxonomyRequest.fromJson(node)
        return PostMetadataCreateRequest(title = node.get("title").stringValue(), summary = node.get("summary").stringValue(),
            categoryId = taxonomy.categoryId, tags = taxonomy.tags,
            seriesId = PostMetadataCreateRequest.optionalLong(node, "seriesId"),
            order = PostMetadataCreateRequest.optionalInt(node, "order"),
            relatedSeriesId = PostMetadataCreateRequest.optionalLong(node, "relatedSeriesId"))
    }
}
