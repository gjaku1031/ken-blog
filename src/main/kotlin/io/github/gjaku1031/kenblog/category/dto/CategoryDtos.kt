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
            if (!node.isObject || !node.has("path") || !node.get("path").isString) throw InvalidCategoryRequestException()
            return CategoryCreateRequest(node.get("path").stringValue())
        }
    }
}

/**
 * 분류 표시 이름 변경 입력, 경로 변경은 허용하지 않음
 */
data class CategoryNameRequest(
    /**
     * 새 표시 이름
     */
    val name: String,
) {
    /**
     * 이름 입력의 엄격한 JSON 검증
     */
    companion object {
        /**
         * name 문자열 하나만 허용
         */
        fun fromJson(node: JsonNode): CategoryNameRequest {
            if (!node.isObject || node.size() != 1 || !node.path("name").isString) throw InvalidCategoryRequestException()
            return CategoryNameRequest(node.get("name").stringValue())
        }
    }
}

/**
 * 같은 부모의 전체 형제 ID를 원하는 순서대로 전달하는 입력
 */
data class CategoryReorderRequest(
    /**
     * 부모 ID, 대분류 정렬은 null
     */
    val parentId: Long?,

    /**
     * 빠짐·중복 없는 전체 형제 ID
     */
    val ids: List<Long>,
) {
    /**
     * 순서 입력의 엄격한 JSON 검증
     */
    companion object {
        /**
         * 필수 부모·ID 배열과 정수 타입 검사, 집합 검증은 서비스에서 수행
         */
        fun fromJson(node: JsonNode): CategoryReorderRequest {
            // 알 수 없는 필드·부모 생략·정수 범위 밖 입력 거부
            if (!node.isObject || node.size() != 2 || !node.has("parentId") || !node.path("ids").isArray)
                throw InvalidCategoryRequestException()
            val parent = node.get("parentId")
            if (!parent.isNull && (!parent.isIntegralNumber || !parent.canConvertToLong())) throw InvalidCategoryRequestException()
            val ids = node.get("ids")
            if (ids.size() > 10_000) throw InvalidCategoryRequestException()
            return CategoryReorderRequest(if (parent.isNull) null else parent.longValue(), (0 until ids.size()).map { index ->
                if (!ids[index].isIntegralNumber || !ids[index].canConvertToLong()) throw InvalidCategoryRequestException()
                ids[index].longValue()
            })
        }
    }
}

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
