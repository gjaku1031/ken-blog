package io.github.gjaku1031.kenblog.attachment.service

import io.github.gjaku1031.kenblog.account.repository.AccountRepository
import io.github.gjaku1031.kenblog.attachment.domain.AttachmentEntity
import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import io.github.gjaku1031.kenblog.attachment.domain.AttachmentStatus
import io.github.gjaku1031.kenblog.attachment.dto.AttachmentResponse
import io.github.gjaku1031.kenblog.attachment.repository.AttachmentRepository
import java.time.Clock
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import org.springframework.data.repository.findByIdOrNull
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** DB 경계를 넘을 때 필요한 불변 첨부 정보. [response]에는 비공개 [objectKey]를 포함하지 않음. */
data class AttachmentSnapshot(val objectKey: String, val response: AttachmentResponse, val pendingCleanup: Boolean)

/**
 * 첨부 상태와 계정 참조를 짧은 DB 트랜잭션으로 처리.
 *
 * OCI 네트워크 호출은 이 구체 서비스 밖에서 실행하며, 상태 전환은 행 잠금으로 직렬화함.
 */
@Service
class AttachmentMetadataService(
    private val attachments: AttachmentRepository,
    private val accounts: AccountRepository,
    private val links: AttachmentLinkService,
) {
    /**
     * 인증 계정에 연결된 PENDING 행을 객체 업로드보다 먼저 확정.
     *
     * @param username 현재 세션에서 얻은 계정명
     * @param key 서버에서 생성한 객체 key
     * @param image 검증된 파일 내용과 메타데이터
     * @return DB ID를 받은 [AttachmentSnapshot]
     * @throws AttachmentFailure 세션 계정이 DB에 없을 때
     */
    @Transactional
    fun createPending(username: String, key: String, image: ValidatedImage): AttachmentSnapshot {
        val account = accounts.findByUsername(username)
            ?: throw AttachmentFailure(HttpStatus.SERVICE_UNAVAILABLE, "업로드 계정을 확인할 수 없습니다.")
        return attachments.saveAndFlush(
            AttachmentEntity(key, image.filename, image.contentType, image.bytes.size.toLong(), account, now()),
        ).snapshot()
    }

    /**
     * 성공한 OCI 업로드의 PENDING 행만 READY로 변경.
     *
     * @param id 앞서 생성한 첨부 ID
     * @return 다운로드 가능한 상태의 [AttachmentSnapshot]
     * @throws AttachmentFailure 삭제와 경쟁했거나 추적 행이 없어졌을 때
     */
    @Transactional
    fun markReady(id: Long): AttachmentSnapshot {
        val entity = attachments.findLockedById(id) ?: throw conflict()
        if (entity.status != AttachmentStatus.PENDING) throw conflict()
        entity.markReady(now())
        return attachments.saveAndFlush(entity).snapshot()
    }

    /**
     * 관리자 조회용 메타데이터를 ID로 조회.
     *
     * @param id 양수 첨부 ID
     * @return 상태를 포함한 [AttachmentSnapshot]
     * @throws AttachmentFailure 행이 없을 때
     */
    @Transactional(readOnly = true)
    fun find(id: Long): AttachmentSnapshot =
        (if (id > 0) attachments.findByIdOrNull(id) else null)?.snapshot() ?: throw notFound()

    /**
     * READY 또는 오래된 PENDING 행을 DELETING으로 변경하고 객체 key를 반환.
     *
     * 글·편집본에 연결된 첨부는 동일 행 잠금 안에서 409로 거부함.
     * 활성 PENDING은 SDK 요청 제한 30초보다 긴 2분 동안 삭제를 거부함.
     * 오래된 PENDING의 행은 늦은 PUT을 추적하도록 삭제 후에도 유예함.
     *
     * @param id 삭제 대상 ID
     * @return 객체 삭제에 필요한 [AttachmentSnapshot]
     * @throws AttachmentFailure 행이 없거나 업로드 중일 때
     */
    @Transactional
    fun beginDelete(id: Long): AttachmentSnapshot {
        val entity = if (id > 0) attachments.findLockedById(id) else null
        entity ?: throw notFound()
        if (links.isReferenced(id)) throw AttachmentFailure(HttpStatus.CONFLICT, "글이나 편집본에서 사용 중인 첨부입니다.")
        if (entity.status == AttachmentStatus.PENDING) {
            if (entity.createdAt.isAfter(now().minusMinutes(PENDING_GRACE_MINUTES))) throw conflict()
            entity.markDeleting(now(), retainForUncertainWrite = true)
            attachments.saveAndFlush(entity)
        } else if (entity.status == AttachmentStatus.READY) {
            entity.markDeleting(now(), retainForUncertainWrite = false)
            attachments.saveAndFlush(entity)
        }
        return entity.snapshot()
    }

    /**
     * 실패한 업로드를 보상 삭제 대상으로 표시. READY면 실제 객체를 삭제하지 않음.
     *
     * @param id 업로드 중 생성한 ID
     * @param uncertainWrite PUT 응답 유실로 뒤늦은 객체 생성을 배제할 수 없는지 여부
     * @return 삭제해도 되는 상태 또는 이미 사라진 행이면 `true`, READY면 `false`
     */
    @Transactional
    fun claimFailedUpload(id: Long, uncertainWrite: Boolean): Boolean {
        val entity = attachments.findLockedById(id) ?: return true
        if (entity.status == AttachmentStatus.READY) return false
        if (entity.status == AttachmentStatus.PENDING) {
            entity.markDeleting(now(), retainForUncertainWrite = uncertainWrite)
            attachments.saveAndFlush(entity)
        }
        return true
    }

    /**
     * 객체 삭제 성공 후 DELETING 행을 제거하거나 불확실한 PUT의 추적 행을 보존.
     *
     * PENDING에서 시작한 삭제는 상태 전환 뒤 2분간 남으며 이후 삭제 재시도로 제거 가능.
     *
     * @param id 객체 삭제를 시도한 첨부 ID
     * @return 행이 제거되었거나 이미 없으면 `true`, 유예 중이면 `false`
     */
    @Transactional
    fun finishDelete(id: Long): Boolean {
        val entity = attachments.findLockedById(id) ?: return true
        if (entity.status != AttachmentStatus.DELETING) throw conflict()
        if (entity.pendingCleanup && entity.updatedAt.isAfter(now().minusMinutes(PENDING_GRACE_MINUTES))) return false
        attachments.delete(entity)
        attachments.flush()
        return true
    }

    /** @return UTC의 마이크로초 정밀도 현재 시각. */
    private fun now(): LocalDateTime = LocalDateTime.ofInstant(Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC)

    /** @return 상태 전환 경쟁을 알리는 고정 HTTP 409 오류. */
    private fun conflict(): AttachmentFailure = AttachmentFailure(HttpStatus.CONFLICT, "첨부가 처리 중입니다.")

    /** @return 없는 첨부를 알리는 고정 HTTP 404 오류. */
    private fun notFound(): AttachmentFailure = AttachmentFailure(HttpStatus.NOT_FOUND, "첨부를 찾을 수 없습니다.")

    /** @return 지연 로드 계정명을 트랜잭션 안에서 추출한 불변 [AttachmentSnapshot]. */
    private fun AttachmentEntity.snapshot(): AttachmentSnapshot = AttachmentSnapshot(
        objectKey,
        AttachmentResponse(id ?: error("Persisted attachment has no ID"), originalFilename, contentType, byteSize,
            uploadedBy.username, status, createdAt, updatedAt),
        pendingCleanup,
    )

    private companion object {
        const val PENDING_GRACE_MINUTES = 2L
    }
}
