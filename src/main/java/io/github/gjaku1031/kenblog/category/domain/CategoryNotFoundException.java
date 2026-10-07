package io.github.gjaku1031.kenblog.category.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 요청한 분류 ID가 DB에 없을 때
 */
public final class CategoryNotFoundException extends BusinessException {
    /**
     * 업무 오류 초기화
     */
    public CategoryNotFoundException() {
        super(HttpStatus.NOT_FOUND, "분류를 찾을 수 없습니다.");
    }
}
