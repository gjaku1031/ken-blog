package io.github.gjaku1031.kenblog.category.dto;

import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException;

import tools.jackson.databind.JsonNode;

/**
 * 관리자 분류 경로 생성 입력
 */
public record CategoryCreateRequest(
        /**
         * 분류 경로
         */
        String path) {
    /**
     * 숫자·불리언을 문자열로 강제 변환하기 전 JSON 문자열 필수 여부를 검증
     *
     * @param node 실제 JSON 요청 본문
     * @return 문자열 경로만 포함한 {@link CategoryCreateRequest}
     * @throws InvalidCategoryRequestException path 누락·null·비문자열일 때
     */
    public static CategoryCreateRequest fromJson(JsonNode node) {
        if (!node.isObject() || !node.has("path") || !node.get("path").isString())
            throw new InvalidCategoryRequestException();
        return new CategoryCreateRequest(node.get("path").stringValue());
    }
}
