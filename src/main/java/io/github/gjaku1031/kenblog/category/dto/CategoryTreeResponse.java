package io.github.gjaku1031.kenblog.category.dto;

import java.util.List;

/**
 * 직접 글 수와 모든 하위 글 수를 구분한 분류 트리 노드
 */
public record CategoryTreeResponse(
        /**
         * ID
         */
        long id,

        /**
         * 분류 경로
         */
        String path,

        /**
         * 이름
         */
        String name,

        /**
         * 분류 깊이, 1~2단계
         */
        int depth,

        /**
         * 정렬 순서
         */
        int sortOrder,

        /**
         * 공개하지 않은 글을 포함한 해당 분류의 직접 글 수
         */
        long directCount,

        /**
         * 공개하지 않은 글을 포함한 해당 분류와 모든 하위 분류의 글 수
         */
        long totalCount,

        /**
         * 빈 분류도 포함한 하위 노드
         */
        List<CategoryTreeResponse> children) {}
