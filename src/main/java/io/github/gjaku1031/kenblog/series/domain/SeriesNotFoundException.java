package io.github.gjaku1031.kenblog.series.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 시리즈가 없는 경우
 */
public final class SeriesNotFoundException extends BusinessException {
    /**
     * 업무 오류 초기화
     */
    public SeriesNotFoundException() {
        super(HttpStatus.NOT_FOUND, "콘텐츠를 찾을 수 없습니다.");
    }
}
