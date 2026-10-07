package io.github.gjaku1031.kenblog.category.dto;

import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException;

import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;

/**
 * 같은 부모의 전체 형제 ID를 원하는 순서대로 전달하는 입력
 */
public record CategoryReorderRequest(
        /**
         * 부모 ID, 대분류 정렬은 null
         */
        Long parentId,

        /**
         * 빠짐·중복 없는 전체 형제 ID
         */
        List<Long> ids) {
    /**
     * 필수 부모·ID 배열과 정수 타입 검사, 집합 검증은 서비스에서 수행
     */
    public static CategoryReorderRequest fromJson(JsonNode node) {
        // 알 수 없는 필드·부모 생략·정수 범위 밖 입력 거부
        if (!node.isObject()
                || node.size() != 2
                || !node.has("parentId")
                || !node.path("ids").isArray()) throw new InvalidCategoryRequestException();
        var parent = node.get("parentId");
        if (!parent.isNull() && (!parent.isIntegralNumber() || !parent.canConvertToLong()))
            throw new InvalidCategoryRequestException();
        var ids = node.get("ids");
        if (ids.size() > 10_000) throw new InvalidCategoryRequestException();
        var result = new ArrayList<Long>();
        for (JsonNode id : ids) {
            if (!id.isIntegralNumber() || !id.canConvertToLong())
                throw new InvalidCategoryRequestException();
            result.add(id.longValue());
        }
        return new CategoryReorderRequest(parent.isNull() ? null : parent.longValue(), result);
    }
}
