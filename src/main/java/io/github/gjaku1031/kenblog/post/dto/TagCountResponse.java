package io.github.gjaku1031.kenblog.post.dto;


/**
 * 초안을 포함한 관리자 태그 사용량
 */
public record TagCountResponse(
        /**
         * 이름
         */
        String name,

        /**
         * 개수
         */
        long count) {}
