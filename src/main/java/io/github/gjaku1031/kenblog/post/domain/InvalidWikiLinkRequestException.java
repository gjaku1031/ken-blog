package io.github.gjaku1031.kenblog.post.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 위키 제목 개수·문자·길이·쿼리 형식이 허용 범위를 벗어나 HTTP 400이 필요한 오류
 */
public final class InvalidWikiLinkRequestException extends BusinessException {
    /**
     * 업무 오류 초기화
     */
    public InvalidWikiLinkRequestException() {
        super(HttpStatus.BAD_REQUEST, "위키 링크 제목 입력을 확인하세요.");
    }
}
