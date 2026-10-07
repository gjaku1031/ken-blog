package io.github.gjaku1031.kenblog.post.repository;

import java.util.List;

/**
 * 본문 없는 글 페이지 조회 결과
 */
public record PostRows(
        /**
         * 조회 결과 목록
         */
        List<PostRow> items,

        /**
         * 전체 결과 수
         */
        long total,

        /**
         * 전체 페이지 수
         */
        int pages) {}
