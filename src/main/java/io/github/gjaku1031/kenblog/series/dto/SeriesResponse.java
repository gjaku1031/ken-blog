package io.github.gjaku1031.kenblog.series.dto;

import io.github.gjaku1031.kenblog.post.domain.PostVisibility;
import io.github.gjaku1031.kenblog.post.dto.PostSeriesItem;
import io.github.gjaku1031.kenblog.series.domain.*;
import io.github.gjaku1031.kenblog.stack.dto.StackBadgeResponse;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 목록과 관리자 편집에 사용하는 시리즈 속성
 * cover는 첫 출간 문서에서 계산
 */
public record SeriesResponse(
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
         * 설명
         */
        String description,

        /**
         * 공개 범위
         */
        PostVisibility visibility,

        /**
         * 프로젝트 진행 상태
         */
        ProjectStatus projectStatus,

        /**
         * 시작 연월
         */
        String startPeriod,

        /**
         * 종료 연월
         */
        String endPeriod,

        /**
         * 정렬 순서
         */
        long sortOrder,

        /**
         * 수정 시각
         */
        LocalDateTime updatedAt,

        /**
         * 첫 출간 문서, 없으면 null
         */
        PostSeriesItem cover,

        /**
         * 문서 수
         */
        int postCount,

        /**
         * 선택 순서의 기술 뱃지 목록
         */
        List<StackBadgeResponse> stackBadges) {}
