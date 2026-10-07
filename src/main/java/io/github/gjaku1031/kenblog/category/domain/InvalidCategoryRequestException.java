package io.github.gjaku1031.kenblog.category.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 경로·깊이·단계 이름 또는 식별자 입력이 분류 계약을 벗어날 때
 */
public final class InvalidCategoryRequestException extends BusinessException {
    /**
     * 업무 오류 초기화
     */
    public InvalidCategoryRequestException() {
        super(HttpStatus.BAD_REQUEST, "분류 입력을 확인하세요.");
    }
}
