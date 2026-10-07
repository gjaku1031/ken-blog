package io.github.gjaku1031.kenblog.series.dto;

import io.github.gjaku1031.kenblog.series.domain.*;

/**
 * 시리즈 생성은 문서 생성과 독립적이며 첫 출간 전에는 공개 목록에 나오지 않음
 */
public record SeriesCreateRequest(
        /**
         * 공개 주소 식별자, 생략하면 서버에서 생성
         */
        String slug,

        /**
         * 시리즈 종류
         */
        SeriesKind kind,

        /**
         * 시리즈 속성 입력
         */
        SeriesMetadataRequest metadata) {}
