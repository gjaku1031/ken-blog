package io.github.gjaku1031.kenblog.series.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 시리즈 입력의 타입·필수값·기간이 잘못된 경우
 */
public final class InvalidSeriesRequestException extends BusinessException {
    /**
     * 업무 오류 초기화
     */
    public InvalidSeriesRequestException() {
        super(HttpStatus.BAD_REQUEST, "콘텐츠 입력을 확인하세요.");
    }
}
