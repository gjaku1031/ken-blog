package io.github.gjaku1031.kenblog.post.dto;


/**
 * 본문·게시글 전체 로드 없이 페이지 ID의 태그를 일괄 조회하는 행
 */
public record PostTagRow(
        /**
         * 게시글 ID
         */
        long postId,

        /**
         * 입력 순서의 0 기반 위치
         */
        int position,

        /**
         * 이름
         */
        String name) {}
