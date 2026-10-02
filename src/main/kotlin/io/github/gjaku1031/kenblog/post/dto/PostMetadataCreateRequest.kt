package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.attachment.dto.AttachmentIds
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import tools.jackson.databind.JsonNode

/**
 * 본문 없이 글 주소·시리즈·분류·첨부 선언만 등록
 * 구획은 시리즈에서 결정
 */
data class PostMetadataCreateRequest(
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
    val summary: String = "",
    /**
     * 분류 ID
     */
    val categoryId: Long? = null,
    /**
     * 태그 목록
     */
    val tags: List<String> = emptyList(),
    /**
     * 시리즈 ID
     */
    val seriesId: Long? = null,
    /**
     * 표시 순서
     */
    val order: Int? = null,
    /**
     * 관련 프로젝트 시리즈 ID
     */
    val relatedSeriesId: Long? = null,
    /**
     * 첨부 ID 목록
     */
    val attachmentIds: List<Long> = emptyList(),
    /**
     * 위키 대상 제목 목록
     */
    val wikiTargets: List<String> = emptyList(),
) {
    /**
     * JSON 입력 검증
     */
    companion object {
        /**
         * 본문·이전 대문/회차 필드와 알 수 없는 입력을 거부
         *
         * 1. 본문·알 수 없는 필드를 제외한 허용 키 검사
         * 2. 태그 배열의 크기와 문자열 타입 검사
         * 3. 필수·선택 필드와 첨부·위키 선언을 검증해 입력 객체 생성
         */
        fun fromJson(node: JsonNode): PostMetadataCreateRequest {
            // 본문·알 수 없는 필드를 제외한 허용 키 검사
            val allowed = setOf("title", "slug", "summary", "categoryId", "tags", "seriesId", "order",
                "relatedSeriesId", "attachmentIds", "wikiTargets")
            if (!node.isObject || node.properties().any { it.key !in allowed }) throw InvalidPostRequestException()
            // 태그 배열의 크기와 문자열 타입 검사
            val tags = node.get("tags")?.let {
                if (!it.isArray || it.size() > 100) throw InvalidPostRequestException()
                (0 until it.size()).map { index ->
                    if (!it[index].isTextual) throw InvalidPostRequestException()
                    it[index].textValue()
                }
            } ?: emptyList()
            // 필수·선택 필드와 첨부·위키 선언을 검증해 입력 객체 생성
            return PostMetadataCreateRequest(requiredString(node, "title"), requiredString(node, "slug"),
                optionalString(node, "summary") ?: "", optionalLong(node, "categoryId"), tags,
                optionalLong(node, "seriesId"), optionalInt(node, "order"), optionalLong(node, "relatedSeriesId"),
                AttachmentIds.parse(node.get("attachmentIds")) ?: emptyList(),
                WikiDeclarations.parse(node.get("wikiTargets")) ?: emptyList())
        }
        /**
         * 필수 JSON 문자열 조회, 누락·다른 타입이면 입력 오류
         */
        private fun requiredString(node: JsonNode, name: String): String = node.get(name)?.takeIf { it.isTextual }
            ?.textValue() ?: throw InvalidPostRequestException()
        /**
         * 선택 JSON 문자열 조회, 다른 타입이면 입력 오류
         */
        private fun optionalString(node: JsonNode, name: String): String? = node.get(name)?.let {
            if (it.isNull) null else if (it.isTextual) it.textValue() else throw InvalidPostRequestException()
        }
        /**
         * 선택 Long 정수 조회, 범위 초과·다른 타입이면 입력 오류
         */
        fun optionalLong(node: JsonNode, name: String): Long? = node.get(name)?.let {
            if (it.isNull) null else if (it.isIntegralNumber && it.canConvertToLong()) it.longValue()
            else throw InvalidPostRequestException()
        }
        /**
         * 선택 Int 정수 조회, 범위 초과·다른 타입이면 입력 오류
         */
        fun optionalInt(node: JsonNode, name: String): Int? = node.get(name)?.let {
            if (it.isNull) null else if (it.isIntegralNumber && it.canConvertToInt()) it.intValue()
            else throw InvalidPostRequestException()
        }
    }
}
