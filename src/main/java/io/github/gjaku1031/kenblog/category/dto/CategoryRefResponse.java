package io.github.gjaku1031.kenblog.category.dto;

import io.github.gjaku1031.kenblog.category.domain.CategoryEntity;

import java.util.Objects;

/**
 * 글과 분류 생성 응답에서 공유하는 저장 분류 참조
 */
public record CategoryRefResponse(
        /**
         * ID
         */
        long id,

        /**
         * 루트부터 이어지는 정규화 경로
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
        int sortOrder) {
    /**
     * 저장 분류에서 외부 참조 생성
     */
    public static CategoryRefResponse from(CategoryEntity entity) {
        return new CategoryRefResponse(
                Objects.requireNonNull(entity.getId(), "Persisted category has no ID"),
                entity.getPath(),
                entity.getName(),
                entity.getDepth(),
                entity.getSortOrder());
    }
}
