package io.github.gjaku1031.kenblog.attachment.dto

/** 글 권한 SQL 통과 후에만 사용하는 비공개 객체 위치·검증된 콘텐츠 헤더 값. */
data class AttachmentDeliveryRow(val objectKey: String, val contentType: String, val byteSize: Long)
