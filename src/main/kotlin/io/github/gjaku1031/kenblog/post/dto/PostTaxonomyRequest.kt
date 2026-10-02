package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import tools.jackson.databind.JsonNode

/**
 * 게시글 분류·태그 전체 교체 계약
 * [fromJson]은 필수 null과 누락을 구별하고 JSON 타입을 엄격히 검사
 */
data class PostTaxonomyRequest(
    /**
     * 분류 ID, 명시 null이면 분류 해제
     */
    val categoryId: Long?,

    /**
     * 순서를 보존할 태그 목록, 빈 배열이면 모두 해제
     */
    val tags: List<String>,
) {
    /**
     * JSON 입력 검증
     */
    companion object {
        /**
         * Jackson의 숫자·불리언 문자열 강제 변환을 거치지 않고 JSON 노드 타입을 검증
         *
         * 1. 필수 키 검사, 분류의 명시 null과 누락 구분
         * 2. 분류 해제 또는 양수 정수 ID로 변환
         * 3. 태그 배열의 모든 원소가 문자열인지 확인
         *
         * @param node 실제 요청 본문
         * @return 명시 categoryId와 문자열 태그 배열을 가진 입력
         * @throws InvalidPostRequestException 누락·null tags·부적절한 JSON 타입 또는 ID일 때
         */
        fun fromJson(node: JsonNode): PostTaxonomyRequest {
            // 필수 키 검사, 분류의 명시 null과 누락 구분
            if (!node.isObject || !node.has("categoryId") || !node.has("tags")) throw InvalidPostRequestException()
            val category = node.get("categoryId")
            // 분류 해제 또는 양수 정수 ID로 변환
            val categoryId = when {
                category.isNull -> null
                category.isIntegralNumber && category.canConvertToLong() && category.longValue() > 0 -> category.longValue()
                else -> throw InvalidPostRequestException()
            }
            // 태그 배열의 모든 원소가 문자열인지 확인
            val tagsNode = node.get("tags")
            if (!tagsNode.isArray) throw InvalidPostRequestException()
            val tags = ArrayList<String>(tagsNode.size())
            for (index in 0 until tagsNode.size()) {
                val tag = tagsNode.get(index)
                if (!tag.isTextual) throw InvalidPostRequestException()
                tags.add(tag.textValue())
            }
            return PostTaxonomyRequest(categoryId, tags)
        }
    }
}
