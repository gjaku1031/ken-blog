package io.github.gjaku1031.kenblog.series.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 소속 글 또는 관련 글이 남아 있어 시리즈 삭제를 거부하는 경우
 */
public final class SeriesInUseException extends BusinessException {
    /**
     * 업무 오류 초기화
     */
    public SeriesInUseException() {
        super(HttpStatus.CONFLICT, "소속 글과 관련된 글을 먼저 모두 삭제해야 합니다. 초안도 포함됩니다.");
    }
}
