package io.github.gjaku1031.kenblog.attachment.service;

import java.io.InputStream;

/**
 * 공개 HTTP 이미지 정보와 호출자가 닫을 로컬 스트림
 */
public record PostAttachmentContent(
        /**
         * MIME 타입
         */
        String contentType,

        /**
         * 파일 크기, 바이트 단위
         */
        long byteSize,

        /**
         * 호출자가 닫아야 하는 입력 스트림
         */
        InputStream stream) {}
