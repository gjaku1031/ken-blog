package io.github.gjaku1031.kenblog.category.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 고유 경로 또는 동시 FK·행잠금 충돌로 분류 변경을 커밋할 수 없을 때
 */
public final class CategoryConflictException extends BusinessException {
    /**
     * 업무 오류 초기화
     */
    public CategoryConflictException() {
        super(HttpStatus.CONFLICT, "분류 변경이 충돌했습니다.");
    }
}
