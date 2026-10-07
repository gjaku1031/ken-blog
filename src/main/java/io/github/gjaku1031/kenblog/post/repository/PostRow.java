package io.github.gjaku1031.kenblog.post.repository;

import io.github.gjaku1031.kenblog.post.domain.*;
import io.github.gjaku1031.kenblog.post.dto.*;

import java.time.LocalDateTime;

/**
 * 본문 열을 선택하지 않는 공통 조회 행
 */
public record PostRow(
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
         * 생성 시각
         */
        LocalDateTime createdAt,

        /**
         * 수정 시각
         */
        LocalDateTime updatedAt,

        /**
         * 최초 출간 시각
         */
        LocalDateTime publishedAt,

        /**
         * 출간 상태
         */
        PostStatus status,

        /**
         * 공개 범위
         */
        PostVisibility visibility,

        /**
         * 분류 ID
         */
        Long categoryId,

        /**
         * 시리즈
         */
        SeriesRef series,

        /**
         * 시리즈 내 정렬 순서
         */
        Integer seriesOrder,

        /**
         * 관련 프로젝트 시리즈 ID
         */
        Long relatedSeriesId,

        /**
         * 이전 공개 경로
         */
        String legacyPath,

        /**
         * 관리자 편집 버전
         */
        long editVersion) {
}
