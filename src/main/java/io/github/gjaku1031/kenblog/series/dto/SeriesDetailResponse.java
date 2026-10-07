package io.github.gjaku1031.kenblog.series.dto;

import java.util.List;

/**
 * 본문 없는 시리즈 메타데이터와 같은 규칙으로 정렬한 글 목록
 */
public record SeriesDetailResponse(
        /**
         * 시리즈
         */
        SeriesResponse series,

        /**
         * 시리즈 문서 목록
         */
        List<SeriesPostResponse> posts) {}
