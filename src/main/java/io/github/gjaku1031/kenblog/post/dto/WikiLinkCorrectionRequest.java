package io.github.gjaku1031.kenblog.post.dto;

import io.github.gjaku1031.kenblog.post.domain.InvalidWikiLinkRequestException;

import tools.jackson.databind.JsonNode;

import java.util.List;

/**
 * 원고와 독립적으로 위키 대상 선언 전체를 교체하는 관리자 입력
 */
public record WikiLinkCorrectionRequest(
        /**
         * 위키 대상 제목 목록
         */
        List<String> wikiTargets) {
    /**
     * 필수 제목 배열만 허용하고 이전 본문 해시 입력도 거부
     */
    public static WikiLinkCorrectionRequest fromJson(JsonNode node) {
        if (!node.isObject() || node.size() != 1 || !node.has("wikiTargets"))
            throw new InvalidWikiLinkRequestException();
        return new WikiLinkCorrectionRequest(WikiDeclarations.required(node.get("wikiTargets")));
    }
}
