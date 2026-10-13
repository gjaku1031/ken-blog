package io.github.gjaku1031.kenblog.post.dto;

import io.github.gjaku1031.kenblog.post.domain.PostStatus;

/**
 * 관리자에게만 보이는 연결 글의 표시 정보
 */
public record PostLinkResponse(
        /**
         * ID
         */
        long id,

        /**
         * 제목
         */
        String title,

        /**
         * 공개 주소 식별자
         */
        String slug,

        /**
         * 공개 범위와 검수 단계
         */
        PostStatus status) {}
