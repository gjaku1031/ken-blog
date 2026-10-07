package io.github.gjaku1031.kenblog.category.dto;

import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException;

import tools.jackson.databind.JsonNode;

/**
 * 분류 표시 이름 변경 입력, 경로 변경은 허용하지 않음
 */
public record CategoryNameRequest(
        /**
         * 새 표시 이름
         */
        String name) {
    /**
     * 이름 문자열 하나만 허용
     */
    public static CategoryNameRequest fromJson(JsonNode node) {
        if (!node.isObject() || node.size() != 1 || !node.path("name").isString())
            throw new InvalidCategoryRequestException();
        return new CategoryNameRequest(node.get("name").stringValue());
    }
}
