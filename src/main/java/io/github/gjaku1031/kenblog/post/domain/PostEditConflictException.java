package io.github.gjaku1031.kenblog.post.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 읽은 뒤 변경된 글을 덮어쓰지 않도록 409로 반환하는 편집 충돌
 */
public final class PostEditConflictException extends BusinessException {
    /**
     * 업무 오류 초기화
     */
    public PostEditConflictException() {
        super(HttpStatus.CONFLICT, "다른 변경이 저장되었습니다. 입력을 복사한 뒤 글을 다시 열어 확인하세요.");
    }
}
