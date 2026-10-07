package io.github.gjaku1031.kenblog.series.dto;

/**
 * 관리자에게는 미출간 문서도 포함하며 공개 상세에는 출간 문서만 포함
 */
public record SeriesPostResponse(
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
         * 표시 순서
         */
        Integer order,

        /**
         * 공개 출간 여부
         */
        boolean published) {}
