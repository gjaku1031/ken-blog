package io.github.gjaku1031.kenblog.post.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 양수 ID에 해당하는 {@code PostEntity}가 없어 관리자 API에서 404로 변환하는 조회 오류
 */
public final class PostNotFoundException extends BusinessException {
    /**
     * 업무 오류 초기화
     */
    public PostNotFoundException() {
        super(HttpStatus.NOT_FOUND, "게시글을 찾을 수 없습니다.");
    }
}
