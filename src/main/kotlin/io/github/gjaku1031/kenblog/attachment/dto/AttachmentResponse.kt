package io.github.gjaku1031.kenblog.attachment.dto

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentStatus
import java.time.LocalDateTime

/**
 * 관리자에게 제공하는 첨부 메타데이터. 비공개 object key와 저장소 설정은 제외함.
 *
 * @property id 첨부 식별자
 * @property originalFilename 화면 표시와 다운로드에 사용하는 안전한 이름
 * @property contentType 실제 이미지에서 판별한 MIME
 * @property byteSize 원본 파일 바이트 수
 * @property uploadedBy 업로드를 요청한 인증 계정명
 * @property status 저장·삭제 처리 상태
 * @property createdAt UTC 생성 시각
 * @property updatedAt UTC 마지막 상태 변경 시각
 */
data class AttachmentResponse(
    val id: Long,
    val originalFilename: String,
    val contentType: String,
    val byteSize: Long,
    val uploadedBy: String,
    val status: AttachmentStatus,
    val createdAt: LocalDateTime,
    val updatedAt: LocalDateTime,
)
