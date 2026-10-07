package io.github.gjaku1031.kenblog.post.domain;

/**
 * 글의 출간 여부
 * 본문은 저장소 Markdown에서만 수정
 */
public enum PostStatus {
    /**
     * 초안
     */
    DRAFT,

    /**
     * 출간
     */
    PUBLISHED
}
