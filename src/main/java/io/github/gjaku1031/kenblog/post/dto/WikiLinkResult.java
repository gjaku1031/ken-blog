package io.github.gjaku1031.kenblog.post.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 요청 제목별 읽기 가능·미존재 결과 계약
 */
public sealed interface WikiLinkResult permits WikiLinkReadable, WikiLinkMissing {
    /**
     * 앞뒤 공백을 제거한 요청 제목
     */
    String requestedTitle();

    /**
     * 읽기 가능·미존재 상태
     */
    @JsonProperty("status")
    WikiLinkStatus status();
}
