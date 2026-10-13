package io.github.gjaku1031.kenblog.post.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 현재 상태·본문 위치와 맞지 않는 공개 전환·검수 요청을 409로 반환하는 충돌
 */
public final class PostStateConflictException extends BusinessException {
    /**
     * 업무 오류 초기화
     *
     * @param publicDetail 관리자 화면에 그대로 보여 줄 충돌 사유
     */
    public PostStateConflictException(String publicDetail) {
        super(HttpStatus.CONFLICT, publicDetail);
    }
}
