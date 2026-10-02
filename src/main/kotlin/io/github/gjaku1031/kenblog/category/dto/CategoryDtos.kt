package io.github.gjaku1031.kenblog.category.dto

import io.github.gjaku1031.kenblog.category.domain.CategoryEntity
import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException
import tools.jackson.databind.JsonNode

/**
 * 관리자 분류 경로 생성 입력
 */
data class CategoryCreateRequest(
    /**
     * 분류 경로
     */
    val path: String,
) {
    /**
     * JSON 입력 검증
     */
    companion object {
        /**
         * 숫자·불리언을 문자열로 강제 변환하기 전 JSON 문자열 필수 여부를 검증
         *
         * @param node 실제 JSON 요청 본문
         * @return 문자열 경로만 포함한 [CategoryCreateRequest]
         * @throws InvalidCategoryRequestException path 누락·null·비문자열일 때
         */
        fun fromJson(node: JsonNode): CategoryCreateRequest {
            if (!node.isObject || !node.has("path") || !node.get("path").isTextual) throw InvalidCategoryRequestException()
            return CategoryCreateRequest(node.get("path").textValue())
        }
    }
}

/**
 * 분류 하나의 숫자 순서 입력
 * 서비스에서 저장 가능한 Int 범위를 검증
 */
data class CategoryOrderRequest(
    /**
     * 표시 순서
     */
    val order: Long
    )

/**
 * 글과 분류 생성 응답에서 공유하는 저장 분류 참조
 */
data class CategoryRefResponse(
    /**
     * ID
     */
    val id: Long,
    /**
     * 루트부터 이어지는 정규화 경로
     */
    val path: String,
    /**
     * 이름
     */
    val name: String,
    /**
     * 분류 깊이, 1~2단계
     */
    val depth: Int,
    /**
     * 정렬 순서
     */
    val sortOrder: Int
    )

/**
 * 직접 글 수와 모든 하위 글 수를 구분한 분류 트리 노드
 */
data class CategoryTreeResponse(
    /**
     * ID
     */
    val id: Long,
    /**
     * 분류 경로
     */
    val path: String,
    /**
     * 이름
     */
    val name: String,
    /**
     * 분류 깊이, 1~2단계
     */
    val depth: Int,
    /**
     * 정렬 순서
     */
    val sortOrder: Int,
    /**
     * 초안을 포함한 해당 분류의 직접 글 수
     */
    val directCount: Long,
    /**
     * 초안을 포함한 해당 분류와 모든 하위 분류의 글 수
     */
    val totalCount: Long,
    /**
     * 빈 분류도 포함한 하위 노드
     */
    val children: List<CategoryTreeResponse>,
)

/**
 * 그룹별 글 수를 본문 없이 가져오는 SQL 집계 행
 */
data class CategoryPostCountRow(
    /**
     * 분류 ID
     */
    val categoryId: Long,
    /**
     * 개수
     */
    val count: Long
    )

/**
 * 저장 분류에서 만든 공개 가능한 참조 DTO
 */
fun CategoryEntity.reference(): CategoryRefResponse =
    CategoryRefResponse(id ?: error("Persisted category has no ID"), path, name, depth, sortOrder)
