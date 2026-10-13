package io.github.gjaku1031.kenblog.post.dto;


/**
 * 공개하지 않은 글을 포함한 관리자 태그 사용량
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
