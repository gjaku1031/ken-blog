package io.github.gjaku1031.kenblog.stack.dto;


/**
 * 등록 기술의 ID·이름과 공개 아이콘 URL
 */
public record StackBadgeResponse(
        /**
         * ID
         */
        long id,

        /**
         * 이름
         */
        String name,

        /**
         * 공개 이미지 URL
         */
        String imageUrl) {}
