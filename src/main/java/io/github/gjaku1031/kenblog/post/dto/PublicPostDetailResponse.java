package io.github.gjaku1031.kenblog.post.dto;

import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse;
import io.github.gjaku1031.kenblog.series.domain.SeriesKind;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Pages 생성용 메타데이터
 * 본문은 Git checkout에서만 주입
 */
public record PublicPostDetailResponse(
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
         * 요약
         */
        String summary,

        /**
         * 한국 시간 기준 출간 날짜
         */
        LocalDate publishedDate,

        /**
         * 탐색 구획
         */
        SeriesKind section,

        /**
         * 분류
         */
        CategoryRefResponse category,

        /**
         * 태그 목록
         */
        List<String> tags,

        /**
         * 시리즈
         */
        PostSeriesResponse series,

        /**
         * 관련 프로젝트 시리즈
         */
        SeriesRef relatedSeries,

        /**
         * 이전 공개 경로
         */
        String legacyPath,

        /**
         * 최초 출간 시각
         */
        LocalDateTime publishedAt) {}
