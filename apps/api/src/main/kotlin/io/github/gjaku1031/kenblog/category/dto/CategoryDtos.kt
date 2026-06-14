package io.github.gjaku1031.kenblog.category.dto

import io.github.gjaku1031.kenblog.category.domain.CategoryEntity
import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException
import io.swagger.v3.oas.annotations.media.Schema
import tools.jackson.databind.JsonNode

/** 관리자 분류 경로 생성 입력. */
data class CategoryCreateRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"], description = "슬래시 구분 1~3단계 경로")
    val path: String,
) {
    companion object {
        /**
         * 숫자·불리언을 문자열로 강제 변환하기 전 JSON 문자열 필수 여부를 검증.
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
 * 글과 분류 생성 응답에서 공유하는 저장 분류 참조.
 *
 * @property id 분류 식별자
 * @property path 루트부터 이어지는 정규화 경로
 * @property name 공백을 정리한 원래 단계 표시명
 * @property depth 1~3단계 깊이
 */
data class CategoryRefResponse(val id: Long, val path: String, val name: String, val depth: Int)

/**
 * 직접 글 수와 모든 하위 글 수를 구분한 분류 트리 노드.
 *
 * @property id 분류 식별자
 * @property path 루트부터 이어지는 정규화 경로
 * @property name 단계 표시명
 * @property depth 1~3단계 깊이
 * @property directCount 현재 역할로 읽을 수 있는 이 분류의 직접 글 수
 * @property totalCount 직접 글과 모든 자손 분류의 읽을 수 있는 글 수 합계
 * @property children 하위 분류 노드; 빈 폴더도 포함
 */
data class CategoryTreeResponse(
    val id: Long,
    val path: String,
    val name: String,
    val depth: Int,
    val directCount: Long,
    val totalCount: Long,
    val children: List<CategoryTreeResponse>,
)

/** 그룹별 글 수를 본문 없이 가져오는 SQL 집계 행. */
data class CategoryPostCountRow(val categoryId: Long, val count: Long)

/** @return 저장 분류에서 만든 공개 가능한 참조 DTO. */
fun CategoryEntity.reference(): CategoryRefResponse =
    CategoryRefResponse(id ?: error("Persisted category has no ID"), path, name, depth)
