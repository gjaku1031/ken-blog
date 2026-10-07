package io.github.gjaku1031.kenblog.post.domain;

/**
 * 기존 비공개 자료를 자동 공개하지 않기 위한 저장 호환 값
 */
public enum PostVisibility {
    /**
     * 공개
     */
    PUBLIC,

    /**
     * 비공개
     */
    PRIVATE
}
