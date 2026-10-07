package io.github.gjaku1031.kenblog.attachment.dto;


/**
 * 글 권한 SQL 통과 후에만 사용하는 비공개 객체 위치·검증된 콘텐츠 헤더 값
 */
public record AttachmentDeliveryRow(
        /**
         * 저장 루트 기준 객체 경로
         */
        String objectKey,

        /**
         * MIME 타입
         */
        String contentType,

        /**
         * 파일 크기, 바이트 단위
         */
        long byteSize) {}
