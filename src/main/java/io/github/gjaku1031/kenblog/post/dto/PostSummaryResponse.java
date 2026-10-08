package io.github.gjaku1031.kenblog.post.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse;
import io.github.gjaku1031.kenblog.post.domain.PostStatus;
import io.github.gjaku1031.kenblog.series.domain.SeriesKind;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 본문 없는 관리자 목록
 */
public record PostSummaryResponse(
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
         * 생성 시각
         */
        LocalDateTime createdAt,

        /**
         * 수정 시각
         */
        LocalDateTime updatedAt,

        /**
         * 출간 상태
         */
        PostStatus status,

        /**
         * 최초 출간 시각
         */
        LocalDateTime publishedAt,

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
        SeriesRef series,

        /**
         * 시리즈 내 정렬 순서
         */
        Integer seriesOrder,

        /**
         * 요약
         */
        String summary,

        /**
         * 관련 프로젝트 시리즈 ID
         */
        Long relatedSeriesId,

        /**
         * 다음 편집 요청의 기준 버전
         */
        long editVersion) {
    /**
     * 시리즈 종류 반환, 소속이 없으면 TECH
     */
    @JsonProperty("section")
    public SeriesKind section() {
        return series == null ? SeriesKind.TECH : series.kind();
    }
}
