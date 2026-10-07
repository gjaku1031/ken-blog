package io.github.gjaku1031.kenblog.post.service;

import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse;

import java.util.List;

/**
 * HTTP DTO를 조립할 때 사용하는 DB 현재 분류 참조와 정렬된 태그
 */
public record PostTaxonomyView(
        /**
         * 분류
         */
        CategoryRefResponse category,

        /**
         * 태그 목록
         */
        List<String> tags) {}
