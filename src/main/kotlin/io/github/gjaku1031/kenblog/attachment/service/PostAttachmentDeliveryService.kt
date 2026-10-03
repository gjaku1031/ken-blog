package io.github.gjaku1031.kenblog.attachment.service

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import io.github.gjaku1031.kenblog.attachment.storage.LocalAssetStorage
import java.io.InputStream
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service

/**
 * 공개 HTTP 헤더에 필요한 안전한 이미지 값과 호출자가 닫을 로컬 파일 스트림
 */
data class PostAttachmentContent(
    /**
     * MIME 타입
     */
    val contentType: String,

    /**
     * 파일 크기, 바이트 단위
     */
    val byteSize: Long,

    /**
     * 호출자가 닫아야 하는 파일 입력 스트림
     */
    val stream: InputStream
)

/**
 * 본문을 읽지 않고 출간 상태와 첨부 연결을 확인한 뒤 DB 트랜잭션 밖에서 파일을 여는 서비스
 */
@Service
class PostAttachmentDeliveryService(
    /**
     * 게시글 메타데이터 조회기
     */
    private val queries: io.github.gjaku1031.kenblog.post.repository.PostQueries,

    /**
     * 로컬 이미지 저장소
     */
    private val storage: LocalAssetStorage,
) {
    /**
     * 현재 공개 출간 글·공개 시리즈·연결·READY를 확인해 이미지를 열음
     *
     * 권한이 없거나 어느 행이든 없으면 같은 404이며, 저장소 실패는 503임
     *
     * 이미 시작한 전송은 후속 공개 범위 변경으로 소급 취소되지 않음
     */
    fun open(postId: Long, attachmentId: Long): PostAttachmentContent {
        if (postId <= 0 || attachmentId <= 0) throw notFound()
        val row = queries.readableAttachment(postId, attachmentId) ?: throw notFound()
        if (row.contentType !in setOf("image/png", "image/jpeg") || row.byteSize !in 1..10L * 1024 * 1024)
            throw AttachmentFailure(HttpStatus.SERVICE_UNAVAILABLE, "첨부 정보를 확인할 수 없습니다.")
        storage.requireConfigured()
        return PostAttachmentContent(row.contentType, row.byteSize, storage.open(row.objectKey, row.byteSize))
    }

    /**
     * 첨부 미존재 오류 객체 생성
     *
     * @return 글·연결·첨부의 부재를 구분하지 않는 HTTP 404용 예외
     */
    private fun notFound(): AttachmentFailure = AttachmentFailure(HttpStatus.NOT_FOUND, "이미지를 찾을 수 없습니다.")
}
