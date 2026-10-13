package io.github.gjaku1031.kenblog.post.domain;

/**
 * 글의 공개 범위와 검수 단계
 * 공개 글의 본문은 저장소 Markdown, 그 밖의 글의 본문은 {@code post_bodies}에 둠
 */
public enum PostStatus {
    /**
     * 미검수, 관리자만 열람하며 검수 뒤 공개 대상
     */
    UNREVIEWED,

    /**
     * 비공개, 관리자만 열람
     */
    PRIVATE,

    /**
     * 공개, Pages 산출물에 포함
     */
    PUBLISHED
}
