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

/** [AttachmentEntity.status]에 기록하는 DB와 OCI Object Storage 간 처리 단계. */
enum class AttachmentStatus { PENDING, READY, DELETING }

/**
 * 비공개 OCI 객체의 위치와 처리 상태를 추적하는 Flyway V4의 `attachments` 행.
 *
 * [objectKey]는 서버가 생성하고 [uploadedBy]는 인증된 계정에서만 가져옴.
 * 새 행은 [AttachmentStatus.PENDING]으로 시작하며 외부 객체 작업은 트랜잭션 밖에서 수행함.
 */
@Entity
@Table(name = "attachments")
class AttachmentEntity protected constructor() {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(name = "object_key", nullable = false, length = 255, unique = true)
    lateinit var objectKey: String
        protected set

    @Column(name = "original_filename", nullable = false, length = 255)
    lateinit var originalFilename: String
        protected set

    @Column(name = "content_type", nullable = false, length = 32)
    lateinit var contentType: String
        protected set

    @Column(name = "byte_size", nullable = false)
    var byteSize: Long = 0
        protected set

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "uploaded_by", nullable = false)
    lateinit var uploadedBy: UserEntity
        protected set

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    lateinit var status: AttachmentStatus
        protected set

    @Column(name = "pending_cleanup", nullable = false)
    var pendingCleanup: Boolean = false
        protected set

    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var createdAt: LocalDateTime
        protected set

    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var updatedAt: LocalDateTime
        protected set

    /**
     * 검증을 마친 한 이미지에 대한 추적 행을 생성.
     *
     * @param objectKey 사용자 입력과 무관한 전용 접두사와 UUID의 key
     * @param originalFilename 화면과 다운로드 헤더에만 사용할 안전한 이름
     * @param contentType 실제 바이트에서 판별한 JPEG 또는 PNG MIME
     * @param byteSize 10 MiB 이하의 실제 바이트 수
     * @param uploadedBy 현재 인증된 관리자 계정
     * @param now UTC 생성 시각
     */
    internal constructor(
        objectKey: String,
        originalFilename: String,
        contentType: String,
        byteSize: Long,
        uploadedBy: UserEntity,
        now: LocalDateTime,
    ) : this() {
        this.objectKey = objectKey
        this.originalFilename = originalFilename
        this.contentType = contentType
        this.byteSize = byteSize
        this.uploadedBy = uploadedBy
        this.status = AttachmentStatus.PENDING
        this.createdAt = now
        this.updatedAt = now
    }

    /**
     * 확인된 업로드를 다운로드 가능한 상태로 변경.
     *
     * @param now UTC 변경 시각
     */
    internal fun markReady(now: LocalDateTime) {
        status = AttachmentStatus.READY
        updatedAt = now
    }

    /**
     * OCI 객체 삭제를 재시도할 수 있도록 상태를 먼저 기록.
     *
     * @param now UTC 변경 시각
     * @param retainForUncertainWrite 늦은 PUT 완료 가능성 때문에 삭제 행을 잠시 보존할지 여부
     */
    internal fun markDeleting(now: LocalDateTime, retainForUncertainWrite: Boolean) {
        status = AttachmentStatus.DELETING
        pendingCleanup = retainForUncertainWrite
        updatedAt = now
    }
}
