package io.github.gjaku1031.kenblog.attachment.service

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import io.github.gjaku1031.kenblog.attachment.domain.AttachmentStatus
import io.github.gjaku1031.kenblog.attachment.domain.PostAttachmentEntity
import io.github.gjaku1031.kenblog.attachment.repository.AttachmentRepository
import io.github.gjaku1031.kenblog.attachment.repository.PostAttachmentRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 글의 이미지 권한 선언을 해당 쓰기 트랜잭션 안에서 교체.
 * 호출자는 부모 글을 먼저 잠그고 이 서비스가 첨부를 ID 오름차순으로 잠금.
 */
@Service
class AttachmentLinkService(
    private val attachments: AttachmentRepository,
    private val posts: PostAttachmentRepository,
) {
    /** @return 게시글에 선언된 첨부 ID의 오름차순 목록. */
    @Transactional(readOnly = true)
    fun postIds(postId: Long): List<Long> = posts.findIdsByPostId(postId)

    /**
     * 잠근 글의 연결을 전부 교체. 빈 목록은 해제이며 실패 시 원본 글 변경까지 롤백됨.
     * @throws AttachmentFailure 없는 ID면 404, READY가 아니면 409
     */
    @Transactional
    fun replacePost(postId: Long, ids: List<Long>) = replacePostInTransaction(postId, ids)

    /** @return 첨부 행잠금 아래에서 글에 연결됐는지 여부. 부모 잠금은 얻지 않음. */
    @Transactional(readOnly = true)
    fun isReferenced(attachmentId: Long): Boolean = posts.existsByAttachmentId(attachmentId)

    /** 이미 열린 부모 쓰기 트랜잭션 안에서 READY 확인과 연결 전체 교체를 수행. */
    private fun replacePostInTransaction(postId: Long, ids: List<Long>) {
        val normalized = ids.distinct().sorted()
        lockReady(normalized)
        posts.deleteByPostId(postId)
        if (normalized.isNotEmpty()) posts.saveAllAndFlush(normalized.map { PostAttachmentEntity(postId, it) })
    }

    /** @throws AttachmentFailure ID별 행잠금에서 없는 첨부 또는 처리 중 상태를 만났을 때. */
    private fun lockReady(ids: List<Long>) {
        for (id in ids) {
            val row = attachments.findLockedById(id)
                ?: throw AttachmentFailure(HttpStatus.NOT_FOUND, "첨부를 찾을 수 없습니다.")
            if (row.status != AttachmentStatus.READY) {
                throw AttachmentFailure(HttpStatus.CONFLICT, "첨부가 처리 중입니다.")
            }
        }
    }
}
