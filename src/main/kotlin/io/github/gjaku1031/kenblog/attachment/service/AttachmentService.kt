package io.github.gjaku1031.kenblog.attachment.service

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import io.github.gjaku1031.kenblog.attachment.domain.AttachmentStatus
import io.github.gjaku1031.kenblog.attachment.dto.AttachmentResponse
import io.github.gjaku1031.kenblog.attachment.storage.OciObjectStorage
import java.io.InputStream
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.multipart.MultipartFile

/** 열린 OCI 본문과 HTTP 헤더에 사용할 메타데이터. 호출자가 [stream]을 닫아야 함. */
data class AttachmentContent(val metadata: AttachmentResponse, val stream: InputStream)

/**
 * [AttachmentMetadataService]의 짧은 트랜잭션과 [OciObjectStorage]의 네트워크 호출을 조합.
 *
 * DB와 OCI는 원자적으로 커밋할 수 없으므로 실패한 업로드는 해당 key만 보상 삭제하고,
 * 불확실한 결과는 PENDING 또는 DELETING 추적 행으로 남김.
 */
@Service
class AttachmentService(
    private val validator: AttachmentImageValidator,
    private val metadata: AttachmentMetadataService,
    private val storage: OciObjectStorage,
) {
    /**
     * 파일을 검증한 뒤 PENDING 기록→OCI 업로드→READY 기록 순서로 생성.
     *
     * @param file 요청의 단일 이미지 파일
     * @param username 인증 세션의 관리자 계정명
     * @return 실제 저장과 READY 전환을 모두 마친 [AttachmentResponse]
     * @throws AttachmentFailure 입력 오류나 OCI 실패일 때
     */
    fun upload(file: MultipartFile, username: String): AttachmentResponse {
        storage.requireConfigured()
        val image = validator.validate(file)
        val key = storage.newKey(image.extension)
        val pending = metadata.createPending(username, key, image)
        val id = pending.response.id
        try {
            storage.put(key, image.bytes, image.contentType)
        } catch (ex: AttachmentFailure) {
            compensate(id, key, uncertainWrite = true)
            throw ex
        }
        return try {
            metadata.markReady(id).response
        } catch (ex: Exception) {
            compensate(id, key, uncertainWrite = false)
            throw ex
        }
    }

    /**
     * 비공개 key를 제외한 관리자용 메타데이터를 조회.
     *
     * @param id 첨부 식별자
     * @return PENDING·READY·DELETING을 포함한 [AttachmentResponse]
     * @throws AttachmentFailure 미설정 또는 없는 첨부일 때
     */
    fun find(id: Long): AttachmentResponse {
        storage.requireConfigured()
        return metadata.find(id).response
    }

    /**
     * READY 객체를 OCI에서 먼저 열어 HTTP 헤더 전 오류를 판별.
     *
     * @param id 첨부 식별자
     * @return Spring 응답이 닫아야 할 [AttachmentContent]
     * @throws AttachmentFailure READY가 아니거나 저장소를 읽을 수 없을 때
     */
    fun open(id: Long): AttachmentContent {
        storage.requireConfigured()
        val attachment = metadata.find(id)
        if (attachment.response.status != AttachmentStatus.READY) {
            throw AttachmentFailure(HttpStatus.CONFLICT, "첨부가 처리 중입니다.")
        }
        return AttachmentContent(attachment.response, storage.open(attachment.objectKey))
    }

    /**
     * DELETING 기록→OCI 삭제→DB 삭제 순서로 재시도 가능한 삭제를 수행.
     *
     * @param id 첨부 식별자
     * @throws AttachmentFailure 없는 첨부, 활성 업로드 또는 OCI 장애일 때
     */
    fun delete(id: Long) {
        storage.requireConfigured()
        val deleting = metadata.beginDelete(id)
        storage.delete(deleting.objectKey)
        if (!metadata.finishDelete(id)) {
            throw AttachmentFailure(HttpStatus.CONFLICT, "첨부 삭제를 정리 중입니다. 잠시 후 재시도하세요.")
        }
    }

    /**
     * 이번 업로드의 객체만 삭제하며 DB 상태 확인이 불가능하면 추적 행을 보존.
     *
     * PUT 실패는 늦은 원격 완료를 배제할 수 없어 DELETING 행을 바로 지우지 않음.
     * READY 갱신 실패는 DB가 READY를 확정했는지 확인하지 못하면 객체를 지우지 않음.
     *
     * @param id 업로드의 추적 행 ID
     * @param key 서버에서 생성한 업로드 key
     * @param uncertainWrite PUT의 최종 원격 결과가 불확실한지 여부
     */
    private fun compensate(id: Long, key: String, uncertainWrite: Boolean) {
        val claimed = try {
            metadata.claimFailedUpload(id, uncertainWrite)
        } catch (_: Exception) {
            null
        }
        if (claimed == false || (claimed == null && !uncertainWrite)) return
        try {
            storage.delete(key)
            if (!uncertainWrite && claimed == true) metadata.finishDelete(id)
        } catch (_: Exception) {
            // 저장소 또는 DB 복구 후 DELETING 행을 대상으로 DELETE를 재시도함.
        }
    }
}
