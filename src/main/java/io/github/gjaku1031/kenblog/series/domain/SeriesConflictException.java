package io.github.gjaku1031.kenblog.series.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 주소 중복·수정 시각 경합 충돌
 */
public final class SeriesConflictException extends BusinessException {
    /**
     * 업무 오류 초기화
     */
    public SeriesConflictException() {
        super(HttpStatus.CONFLICT, "콘텐츠 변경이 충돌했습니다.");
    }
}
