package io.github.gjaku1031.kenblog.post.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 초안 또는 일치하는 출간 글이 없는 요청의 결과
 */
public record WikiLinkMissing(
        /**
         * 조회 요청 제목
         */
        String requestedTitle) implements WikiLinkResult {
    /**
     * 위키 조회 상태
     */
    @Override
    @JsonProperty("status")
    public WikiLinkStatus status() {
        return WikiLinkStatus.MISSING;
    }
}
