package io.github.gjaku1031.kenblog.post.dto;


/**
 * 관리자 제목 검색의 본문 없는 게시글 이동 정보
 */
public record WikiNavigationItem(
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
        String seriesSlug,

        /**
         * 시리즈 이름
         */
        String seriesName) {}
