package io.github.gjaku1031.kenblog.category.dto;


/**
 * 그룹별 글 수를 본문 없이 가져오는 SQL 집계 행
 */
public record CategoryPostCountRow(
        /**
         * 분류 ID
         */
        long categoryId,

        /**
         * 개수
         */
        long count) {}
