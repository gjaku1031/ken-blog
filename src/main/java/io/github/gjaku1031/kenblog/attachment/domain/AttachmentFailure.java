package io.github.gjaku1031.kenblog.attachment.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 첨부 입력·상태·저장소 실패를 비밀값 없는 HTTP 상태로 전달
 */
public final class AttachmentFailure extends BusinessException {
    /**
     * object key·공급자 원문·파일명이 없는 공개 오류 초기화
     */
    public AttachmentFailure(HttpStatus status, String publicDetail) {
        super(status, publicDetail);
    }
}
