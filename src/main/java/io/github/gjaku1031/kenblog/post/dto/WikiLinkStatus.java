package io.github.gjaku1031.kenblog.post.dto;

/**
 * 제목으로 찾은 출간 글의 열람 상태
 */
public enum WikiLinkStatus {
    /**
     * 읽기 가능
     */
    READABLE,

    /**
     * 일치하는 공개 글 없음
     */
    MISSING
}
