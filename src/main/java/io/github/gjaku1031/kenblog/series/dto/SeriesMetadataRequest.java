package io.github.gjaku1031.kenblog.series.dto;

import io.github.gjaku1031.kenblog.series.domain.*;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 변경할 시리즈 속성
 * 종류와 주소 변경은 허용하지 않음
 */
public record SeriesMetadataRequest(
        /**
         * 이름
         */
        String name,

        /**
         * 설명
         */
        String description,

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
         * 선택한 기술 이름 목록
         */
        List<String> stackBadgeNames,

        /**
         * 수정 충돌 확인용 기존 수정 시각
         */
        LocalDateTime baseUpdatedAt) {}
