package io.github.gjaku1031.kenblog.attachment.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 운영자가 서버 디스크에 둔 이미지 파일의 key·형식·크기를 기록하는 {@code attachments} 행
 *
 * 쓰기 API 없이 DB와 로컬 파일을 직접 관리하는 읽기 모델
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
