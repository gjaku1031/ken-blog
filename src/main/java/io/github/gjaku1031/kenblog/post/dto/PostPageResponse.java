package io.github.gjaku1031.kenblog.post.dto;

import java.util.List;

/**
 * 관리자 목록의 페이지 정보
 */
public record PostPageResponse(
        /**
         * 조회 결과 목록
         */
        List<PostSummaryResponse> items,

        /**
         * 0 기반 페이지 번호
         */
        int page,

        /**
         * 페이지 크기
         */
        int size,

        /**
         * 전체 결과 수
         */
        long totalElements,

        /**
         * 전체 페이지 수
         */
        int totalPages) {}
