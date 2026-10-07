package io.github.gjaku1031.kenblog.post.dto;

import io.github.gjaku1031.kenblog.series.domain.SeriesKind;

/**
 * 시리즈의 최소 이동 정보
 * 종류는 시리즈 소속으로 결정
 */
public record SeriesRef(
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
        SeriesKind kind) {}
