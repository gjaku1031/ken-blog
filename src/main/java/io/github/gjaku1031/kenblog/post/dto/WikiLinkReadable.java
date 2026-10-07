package io.github.gjaku1031.kenblog.post.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 현재 권한으로 읽을 수 있는 출간 글의 이동 정보
 *
 * 본문·분류·태그·첨부 메타데이터는 조회하지 않음
 */
public record WikiLinkReadable(
        /**
         * 조회 요청 제목
         */
        String requestedTitle,

        /**
         * ID
         */
        long id,

        /**
         * 제목
         */
        String title,

        /**
         * 공개 주소 식별자
         */
        String slug,

        /**
         * 탐색 구획
         */
        String section,

        /**
         * 시리즈 주소 식별자
         */
        String seriesSlug)
        implements WikiLinkResult {
    /**
     * 위키 조회 상태
     */
    @Override
    @JsonProperty("status")
    public WikiLinkStatus status() {
        return WikiLinkStatus.READABLE;
    }
}
