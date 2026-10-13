package io.github.gjaku1031.kenblog.post.dto;

import java.time.LocalDateTime;

/**
 * 관리자 열람용 DB 본문
 */
public record PostBodyResponse(
        /**
         * 게시글 ID
         */
        long postId,

        /**
         * Markdown 본문
         */
        String body,

        /**
         * 본문 수정 시각, 검수 완료 요청에 그대로 되돌려 보내는 값
         */
        LocalDateTime updatedAt) {}
