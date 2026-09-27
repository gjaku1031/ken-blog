package io.github.gjaku1031.kenblog.stack.service

import io.github.gjaku1031.kenblog.attachment.service.ManagedImageNormalizer
import io.github.gjaku1031.kenblog.attachment.storage.OciObjectStorage
import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import io.github.gjaku1031.kenblog.project.repository.ProjectRepository
import io.github.gjaku1031.kenblog.stack.domain.ProjectStackBadgeEntity
import io.github.gjaku1031.kenblog.stack.domain.StackBadgeEntity
import io.github.gjaku1031.kenblog.stack.dto.StackBadgeResponse
import io.github.gjaku1031.kenblog.stack.repository.ProjectStackBadgeRepository
import io.github.gjaku1031.kenblog.stack.repository.StackBadgeRepository
import java.io.InputStream
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.Locale
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.repository.findByIdOrNull
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.web.multipart.MultipartFile

/** OCI 아이콘과 프로젝트의 뱃지 선택을 ID로 관리하는 구체 서비스. */
@Service
class StackBadgeService(
    private val badges: StackBadgeRepository,
    private val links: ProjectStackBadgeRepository,
    private val projects: ProjectRepository,
    private val images: ManagedImageNormalizer,
    private val storage: OciObjectStorage,
) {
    /** @return 비공개 프로젝트 사용 수를 제외한 이름순 전체 뱃지. */
    @Transactional(readOnly = true)
    fun list(): List<StackBadgeResponse> = badges.findAll().sortedBy { it.name.lowercase(Locale.ROOT) }.map { it.response(false) }

    /** @return 관리자에게만 전체 프로젝트 사용 수를 포함해 전달할 뱃지 목록. */
    @Transactional(readOnly = true)
    fun listAdmin(): List<StackBadgeResponse> = badges.findAll().sortedBy { it.name.lowercase(Locale.ROOT) }.map { it.response(true) }

    /** @return 프로젝트 출간 속성에서 사용할 선택 순서의 뱃지 목록. */
    @Transactional(readOnly = true)
    fun listForProject(projectId: Long): List<StackBadgeResponse> = links.findByIdProjectIdOrderBySortOrder(projectId).mapNotNull {
        badges.findByIdOrNull(it.id.badgeId)?.response(false)
    }

    /**
     * 프로젝트 대문의 이름 배열을 등록된 ID 연결로 교체.
     *
     * @throws OperationFailure 없는 프로젝트나 등록되지 않은 이름·중복 입력일 때
     */
    @Transactional
    fun replaceProjectStack(projectId: Long, names: List<String>) {
        if (projectId <= 0 || !projects.existsById(projectId) || names.size > 30) badInput()
        val selected = names.map { name ->
            val key = nameKey(name)
            badges.findByNameKey(key) ?: badInput()
        }
        if (selected.map { it.id }.toSet().size != selected.size) badInput()
        links.deleteByIdProjectId(projectId)
        links.flush()
        links.saveAllAndFlush(selected.mapIndexed { index, badge ->
            ProjectStackBadgeEntity(projectId, badge.id ?: error("Persisted badge has no ID"), index)
        })
    }

    /**
     * 업로드 이미지를 64×64 PNG로 만들고 중복 이름을 거부해 등록.
     *
     * @return 생성된 공개 뱃지 DTO
     */
    @Transactional
    fun create(name: String, file: MultipartFile): StackBadgeResponse {
        val clean = displayName(name)
        val keyName = nameKey(clean)
        if (badges.findByNameKey(keyName) != null) duplicate()
        val png = images.normalize(file, 64)
        storage.requireConfigured()
        val key = storage.newKey("png")
        storage.put(key, png, "image/png")
        cleanupOnRollback(key)
        return try {
            badges.saveAndFlush(StackBadgeEntity(clean, keyName, key, now())).response(true)
        } catch (_: DataIntegrityViolationException) {
            duplicate()
        }
    }

    /** @return 수정 후 ID 연결을 유지한 뱃지. */
    @Transactional
    fun rename(id: Long, name: String): StackBadgeResponse {
        val badge = badge(id)
        val clean = displayName(name)
        val key = nameKey(clean)
        if (badges.findByNameKey(key)?.id?.let { it != id } == true) duplicate()
        badge.rename(clean, key, now())
        return try {
            badges.saveAndFlush(badge).response(true)
        } catch (_: DataIntegrityViolationException) {
            duplicate()
        }
    }

    /** 새 64×64 PNG를 저장한 후 DB를 전환하고 커밋 뒤 이전 객체를 제거. */
    @Transactional
    fun replaceImage(id: Long, file: MultipartFile): StackBadgeResponse {
        val badge = badge(id)
        val png = images.normalize(file, 64)
        storage.requireConfigured()
        val key = storage.newKey("png")
        storage.put(key, png, "image/png")
        cleanupOnRollback(key)
        val previous = badge.replaceImage(key, now())
        val response = badges.saveAndFlush(badge).response(true)
        cleanupAfterCommit(previous)
        return response
    }

    /** 프로젝트 FK 연결을 cascade로 제거하고 커밋 뒤 아이콘 객체를 제거. */
    @Transactional
    fun delete(id: Long) {
        val badge = badge(id)
        badges.delete(badge)
        badges.flush()
        cleanupAfterCommit(badge.objectKey)
    }

    /** @return 등록된 뱃지의 공개 PNG 스트림. 호출자가 닫아야 함. */
    @Transactional(readOnly = true)
    fun openImage(id: Long): InputStream = storage.open(badge(id).objectKey)

    /** @return 공개 URL과 프로젝트 사용 수를 포함한 DTO. */
    private fun StackBadgeEntity.response(includeUsage: Boolean): StackBadgeResponse {
        val key = id ?: error("Persisted badge has no ID")
        return StackBadgeResponse(key, name, "/api/v1/stack-badges/$key/image?v=$updatedAt", if (includeUsage) links.countByIdBadgeId(key) else null)
    }

    /** @return 존재하는 뱃지 또는 고정 404. */
    private fun badge(id: Long): StackBadgeEntity =
        (if (id > 0) badges.findByIdOrNull(id) else null)
            ?: throw OperationFailure(HttpStatus.NOT_FOUND, "기술 뱃지를 찾을 수 없습니다.")

    /** @return 길이와 제어문자를 검증한 표시 이름. */
    private fun displayName(value: String): String = value.trim().also {
        if (it.isBlank() || it.length > 100 || it.any(Char::isISOControl)) badInput()
    }

    /** @return 중복 비교용 소문자 이름. */
    private fun nameKey(value: String): String = displayName(value).lowercase(Locale.ROOT)

    /** @return 현재 UTC DB 시각. */
    private fun now(): LocalDateTime = LocalDateTime.now(ZoneOffset.UTC)

    /** 롤백 때 새 객체만 보상 삭제. */
    private fun cleanupOnRollback(key: String) {
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            /** 롤백 결과가 확정된 뒤 새 OCI 객체를 보상 삭제. */
            override fun afterCompletion(status: Int) {
                if (status != TransactionSynchronization.STATUS_COMMITTED) runCatching { storage.delete(key) }
            }
        })
    }

    /** DB 커밋이 끝난 경우에만 이전 객체 삭제. */
    private fun cleanupAfterCommit(key: String) {
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            /** DB 커밋이 끝난 뒤 더 이상 참조하지 않는 이전 객체를 삭제. */
            override fun afterCommit() { runCatching { storage.delete(key) } }
        })
    }

    /** @return 입력 실패의 안전한 400. */
    private fun badInput(): Nothing = throw OperationFailure(HttpStatus.BAD_REQUEST, "기술 뱃지 입력을 확인하세요.")

    /** @return 중복 이름의 안전한 409. */
    private fun duplicate(): Nothing = throw OperationFailure(HttpStatus.CONFLICT, "이미 등록된 이름입니다.")
}
