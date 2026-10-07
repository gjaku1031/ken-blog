package io.github.gjaku1031.kenblog.attachment.domain;


/**
 * {@code AttachmentEntity.status}에 기록하는 DB와 로컬 파일 간 처리 단계
 */
public enum AttachmentStatus {
    /**
     * 처리 대기
     */
    PENDING,

    /**
     * 조회 가능
     */
    READY,

    /**
     * 삭제 처리 중
     */
    DELETING
}
