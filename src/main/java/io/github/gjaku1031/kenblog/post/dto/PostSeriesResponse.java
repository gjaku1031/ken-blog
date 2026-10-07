package io.github.gjaku1031.kenblog.post.dto;

import io.github.gjaku1031.kenblog.series.domain.SeriesKind;

import java.util.List;

/**
 * 단일 문서도 포함하는 시리즈 이름·목록·현재 위치
 */
public record PostSeriesResponse(
        /**
         * ID
         */
        long id,

        /**
         * 공개 주소 식별자
         */
        String slug,

        /**
         * 이름
         */
        String name,

        /**
         * 시리즈 종류
         */
        SeriesKind kind,

        /**
         * 조회 결과 목록
         */
        List<PostSeriesItem> items,

        /**
         * 시리즈 내 1 기반 위치
         */
        int position) {}
