package io.github.gjaku1031.kenblog.post.dto;


/**
 * 첫 출간 글과 같은 공통 문서 이동 정보
 * order는 시리즈 내 1기반 표시 위치
 */
public record PostSeriesItem(
        /**
         * ID
         */
        long id,

        /**
         * 공개 주소 식별자
         */
        String slug,

        /**
         * 제목
         */
        String title,

        /**
         * 표시 순서
         */
        int order) {}
