package io.github.gjaku1031.kenblog.post.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 관리자 API의 ID·페이지 경계가 허용 범위를 벗어났을 때 400으로 변환하는 요청 오류
 */
public final class InvalidPostRequestException extends BusinessException {
    /**
     * 업무 오류 초기화
     */
    public InvalidPostRequestException() {
        super(HttpStatus.BAD_REQUEST, "게시글 입력을 확인하세요.");
    }
}
