package io.github.gjaku1031.kenblog.attachment.domain

import io.github.gjaku1031.kenblog.account.domain.UserEntity
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.FetchType
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table
import java.time.LocalDateTime

/**
 * [AttachmentEntity.status]에 기록하는 DB와 로컬 파일 간 처리 단계
 */
enum class AttachmentStatus {
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

/**
 * 비공개 이미지 파일의 key와 처리 상태를 추적하는 `attachments` 행
 *
 * DB와 로컬 파일을 직접 관리하며 기존 ID·열·상태 값과 FK 스키마를 보존하는 읽기 모델
 */
@Entity
@Table(name = "attachments")
class AttachmentEntity protected constructor() {
    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    /**
     * 저장 루트 기준 객체 경로
     */
    @Column(name = "object_key", nullable = false, length = 255, unique = true, columnDefinition = "varchar(255) character set ascii collate ascii_bin")
    lateinit var objectKey: String
        protected set

    /**
     * 원본 파일명
     */
    @Column(name = "original_filename", nullable = false, length = 255)
    lateinit var originalFilename: String
        protected set

    /**
     * MIME 타입
     */
    @Column(name = "content_type", nullable = false, length = 32)
    lateinit var contentType: String
        protected set

    /**
     * 파일 크기, 바이트 단위
     */
    @Column(name = "byte_size", nullable = false)
    var byteSize: Long = 0
        protected set

    /**
     * 등록 계정 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "uploaded_by", nullable = false)
    lateinit var uploadedBy: UserEntity
        protected set

    /**
     * 첨부 처리 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    lateinit var status: AttachmentStatus
        protected set

    /**
     * 정리 대기 여부
     */
    @Column(name = "pending_cleanup", nullable = false)
    var pendingCleanup: Boolean = false
        protected set

    /**
     * 생성 시각
     */
    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var createdAt: LocalDateTime
        protected set

    /**
     * 수정 시각
     */
    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var updatedAt: LocalDateTime
        protected set

}
