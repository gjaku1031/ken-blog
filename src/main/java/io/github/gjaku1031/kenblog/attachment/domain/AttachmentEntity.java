package io.github.gjaku1031.kenblog.attachment.domain;

import io.github.gjaku1031.kenblog.account.domain.UserEntity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 비공개 이미지 파일의 key와 처리 상태를 추적하는 {@code attachments} 행
 *
 * DB와 로컬 파일을 직접 관리하며 기존 ID·열·상태 값과 FK 스키마를 보존하는 읽기 모델
 */
@Entity
@Table(name = "attachments")
public class AttachmentEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected AttachmentEntity() {}

    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id = null;

    /**
     * 저장 루트 기준 객체 경로
     */
    @Column(
            name = "object_key",
            nullable = false,
            length = 255,
            unique = true,
            columnDefinition = "varchar(255) character set ascii collate ascii_bin")
    private String objectKey;

    /**
     * 원본 파일명
     */
    @Column(name = "original_filename", nullable = false, length = 255)
    private String originalFilename;

    /**
     * MIME 타입
     */
    @Column(name = "content_type", nullable = false, length = 32)
    private String contentType;

    /**
     * 파일 크기, 바이트 단위
     */
    @Column(name = "byte_size", nullable = false)
    private long byteSize = 0L;

    /**
     * 등록 계정 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "uploaded_by", nullable = false)
    private UserEntity uploadedBy;

    /**
     * 첨부 처리 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private AttachmentStatus status;

    /**
     * 정리 대기 여부
     */
    @Column(name = "pending_cleanup", nullable = false)
    private boolean pendingCleanup = false;

    /**
     * 생성 시각
     */
    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    private LocalDateTime createdAt;

    /**
     * 수정 시각
     */
    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    private LocalDateTime updatedAt;

    /**
     * id 조회
     */
    public Long getId() {
        return id;
    }

    /**
     * JPA 프록시의 id 변경
     */
    protected void setId(Long id) {
        this.id = id;
    }

    /**
     * objectKey 조회
     */
    public String getObjectKey() {
        return objectKey;
    }

    /**
     * JPA 프록시의 objectKey 변경
     */
    protected void setObjectKey(String objectKey) {
        this.objectKey = objectKey;
    }

    /**
     * originalFilename 조회
     */
    public String getOriginalFilename() {
        return originalFilename;
    }

    /**
     * JPA 프록시의 originalFilename 변경
     */
    protected void setOriginalFilename(String originalFilename) {
        this.originalFilename = originalFilename;
    }

    /**
     * contentType 조회
     */
    public String getContentType() {
        return contentType;
    }

    /**
     * JPA 프록시의 contentType 변경
     */
    protected void setContentType(String contentType) {
        this.contentType = contentType;
    }

    /**
     * byteSize 조회
     */
    public long getByteSize() {
        return byteSize;
    }

    /**
     * JPA 프록시의 byteSize 변경
     */
    protected void setByteSize(long byteSize) {
        this.byteSize = byteSize;
    }

    /**
     * uploadedBy 조회
     */
    public UserEntity getUploadedBy() {
        return uploadedBy;
    }

    /**
     * JPA 프록시의 uploadedBy 변경
     */
    protected void setUploadedBy(UserEntity uploadedBy) {
        this.uploadedBy = uploadedBy;
    }

    /**
     * status 조회
     */
    public AttachmentStatus getStatus() {
        return status;
    }

    /**
     * JPA 프록시의 status 변경
     */
    protected void setStatus(AttachmentStatus status) {
        this.status = status;
    }

    /**
     * pendingCleanup 조회
     */
    public boolean getPendingCleanup() {
        return pendingCleanup;
    }

    /**
     * JPA 프록시의 pendingCleanup 변경
     */
    protected void setPendingCleanup(boolean pendingCleanup) {
        this.pendingCleanup = pendingCleanup;
    }

    /**
     * createdAt 조회
     */
    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    /**
     * JPA 프록시의 createdAt 변경
     */
    protected void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    /**
     * updatedAt 조회
     */
    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    /**
     * JPA 프록시의 updatedAt 변경
     */
    protected void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}
