package io.github.gjaku1031.kenblog.attachment.service

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import io.github.gjaku1031.kenblog.attachment.domain.AttachmentStatus
import io.github.gjaku1031.kenblog.attachment.repository.PostAttachmentRepository
import io.github.gjaku1031.kenblog.attachment.storage.OciObjectStorage
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import java.io.InputStream
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.stereotype.Service

/** 공개 HTTP 헤더에 필요한 안전한 이미지 값과 호출자가 닫을 OCI 스트림. */
data class PostAttachmentContent(val contentType: String, val byteSize: Long, val stream: InputStream)

/** 본문·Redis 없이 현재 글 권한을 DB에서 판정한 뒤 DB 트랜잭션 밖에서 OCI 객체를 여는 서비스. */
@Service
class PostAttachmentDeliveryService(
    private val links: PostAttachmentRepository,
    private val storage: OciObjectStorage,
) {
    /**
     * 현재 출간 글·연결·READY와 명시적 USER/ADMIN 역할을 확인해 이미지를 열음.
     * 권한이 없거나 어느 행이든 없으면 같은 404이며, 저장소 실패는 503임.
     * 이미 시작한 전송은 후속 공개 범위 변경으로 소급 취소되지 않음.
     */
    fun open(postId: Long, attachmentId: Long, authentication: Authentication?): PostAttachmentContent {
        if (postId <= 0 || attachmentId <= 0) throw notFound()
        val includePrivate = authentication?.isAuthenticated == true && authentication.authorities.any {
            it.authority == "ROLE_USER" || it.authority == "ROLE_ADMIN"
        }
        val row = links.findReadable(postId, attachmentId, PostStatus.PUBLISHED, PostVisibility.PUBLIC,
            includePrivate, AttachmentStatus.READY) ?: throw notFound()
        storage.requireConfigured()
        return PostAttachmentContent(row.contentType, row.byteSize, storage.open(row.objectKey))
    }

    /** @return 정보 누출을 막는 글·연결·첨부 공통 HTTP 404. */
    private fun notFound(): AttachmentFailure = AttachmentFailure(HttpStatus.NOT_FOUND, "이미지를 찾을 수 없습니다.")
}
