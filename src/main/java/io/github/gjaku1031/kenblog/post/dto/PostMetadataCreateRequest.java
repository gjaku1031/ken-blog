package io.github.gjaku1031.kenblog.post.dto;

import io.github.gjaku1031.kenblog.attachment.dto.AttachmentIds;
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException;

import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * 본문 없이 글 주소·시리즈·분류·첨부 선언만 등록
 * 구획은 시리즈에서 결정
 */
public record PostMetadataCreateRequest(
        /**
         * 제목
         */
        String title,

        /**
         * 공개 주소 식별자, 생략하면 서버에서 생성
         */
        String slug,

        /**
         * 요약
         */
        String summary,

        /**
         * 분류 ID
         */
        Long categoryId,

        /**
         * 태그 목록
         */
        List<String> tags,

        /**
         * 시리즈 ID
         */
        Long seriesId,

        /**
         * 표시 순서
         */
        Integer order,

        /**
         * 관련 프로젝트 시리즈 ID
         */
        Long relatedSeriesId,

        /**
         * 첨부 ID 목록
         */
        List<Long> attachmentIds,

        /**
         * 위키 대상 제목 목록
         */
        List<String> wikiTargets) {
    /**
     * 제목만 지정한 기본 메타데이터
     */
    public PostMetadataCreateRequest(String title) {
        this(title, null, "", null, List.of(), null, null, null, List.of(), List.of());
    }

    /**
     * 허용 키·배열 타입 검사 후 주소 생략과 선택 선언을 보존
     */
    public static PostMetadataCreateRequest fromJson(JsonNode node) {
        var allowed =
                Set.of(
                        "title",
                        "slug",
                        "summary",
                        "categoryId",
                        "tags",
                        "seriesId",
                        "order",
                        "relatedSeriesId",
                        "attachmentIds",
                        "wikiTargets");
        if (!node.isObject()
                || node.properties().stream().anyMatch(entry -> !allowed.contains(entry.getKey())))
            throw new InvalidPostRequestException();
        // 누락한 배열만 기본값으로 처리; 명시 null tags는 오류
        var tags = new ArrayList<String>();
        var values = node.get("tags");
        if (values != null) {
            if (!values.isArray() || values.size() > 100) throw new InvalidPostRequestException();
            for (JsonNode value : values) {
                if (!value.isString()) throw new InvalidPostRequestException();
                tags.add(value.stringValue());
            }
        }
        // 메타데이터와 연결 선언을 각 입력 규칙으로 검증
        var attachments = AttachmentIds.parse(node.get("attachmentIds"));
        var targets = WikiDeclarations.parse(node.get("wikiTargets"));
        String summary = optionalString(node, "summary");
        return new PostMetadataCreateRequest(
                requiredString(node, "title"),
                optionalString(node, "slug"),
                summary == null ? "" : summary,
                optionalLong(node, "categoryId"),
                tags,
                optionalLong(node, "seriesId"),
                optionalInt(node, "order"),
                optionalLong(node, "relatedSeriesId"),
                attachments == null ? List.of() : attachments,
                targets == null ? List.of() : targets);
    }

    /**
     * 필수 JSON 문자열 조회
     */
    private static String requiredString(JsonNode node, String name) {
        var value = node.get(name);
        if (value == null || !value.isString()) throw new InvalidPostRequestException();
        return value.stringValue();
    }

    /**
     * 선택 문자열의 null·타입 검사
     */
    private static String optionalString(JsonNode node, String name) {
        var value = node.get(name);
        if (value == null || value.isNull()) return null;
        if (!value.isString()) throw new InvalidPostRequestException();
        return value.stringValue();
    }

    /**
     * 선택 Long 정수의 null·범위 검사
     */
    public static Long optionalLong(JsonNode node, String name) {
        var value = node.get(name);
        if (value == null || value.isNull()) return null;
        if (!value.isIntegralNumber() || !value.canConvertToLong())
            throw new InvalidPostRequestException();
        return value.longValue();
    }

    /**
     * 선택 Integer 정수의 null·범위 검사
     */
    public static Integer optionalInt(JsonNode node, String name) {
        var value = node.get(name);
        if (value == null || value.isNull()) return null;
        if (!value.isIntegralNumber() || !value.canConvertToInt())
            throw new InvalidPostRequestException();
        return value.intValue();
    }
}
