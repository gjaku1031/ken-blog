package io.github.gjaku1031.kenblog.post.dto;

import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException;

import tools.jackson.databind.JsonNode;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 본문·주소 관계를 제외한 원자적 편집 요청의 엄격한 JSON 경계
 */
public final class PostEditRequest {
    /**
     * 정적 입력 검증 전용
     */
    private PostEditRequest() {}

    /**
     * 기준 버전 누락·강제 변환·음수·브라우저 정수 범위 초과 거부
     */
    public static long version(JsonNode node) {
        var value = node.get("baseVersion");
        if (value == null
                || !value.isIntegralNumber()
                || !value.canConvertToLong()
                || value.longValue() < 0
                || value.longValue() > 9_007_199_254_740_991L)
            throw new InvalidPostRequestException();
        return value.longValue();
    }

    /**
     * 모든 편집 키를 필수로 받아 부분 저장과 알 수 없는 필드 거부
     */
    public static PostMetadataCreateRequest metadata(JsonNode node) {
        var keys =
                Set.of(
                        "baseVersion",
                        "title",
                        "summary",
                        "categoryId",
                        "tags",
                        "seriesId",
                        "order",
                        "relatedSeriesId");
        if (!node.isObject()
                || !node.properties().stream()
                        .map(Map.Entry::getKey)
                        .collect(Collectors.toSet())
                        .equals(keys)
                || !node.path("title").isString()
                || !node.path("summary").isString()) throw new InvalidPostRequestException();
        version(node);
        var taxonomy = PostTaxonomyRequest.fromJson(node);
        return new PostMetadataCreateRequest(
                node.get("title").stringValue(),
                null,
                node.get("summary").stringValue(),
                taxonomy.categoryId(),
                taxonomy.tags(),
                PostMetadataCreateRequest.optionalLong(node, "seriesId"),
                PostMetadataCreateRequest.optionalInt(node, "order"),
                PostMetadataCreateRequest.optionalLong(node, "relatedSeriesId"),
                List.of());
    }
}
