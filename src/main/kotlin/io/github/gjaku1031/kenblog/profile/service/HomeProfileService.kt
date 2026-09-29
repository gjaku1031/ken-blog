package io.github.gjaku1031.kenblog.profile.service

import io.github.gjaku1031.kenblog.attachment.service.ManagedImageNormalizer
import io.github.gjaku1031.kenblog.attachment.storage.OciObjectStorage
import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import io.github.gjaku1031.kenblog.profile.domain.HomeProfileEntity
import io.github.gjaku1031.kenblog.profile.dto.HomeProfileRequest
import io.github.gjaku1031.kenblog.profile.dto.HomeProfileResponse
import io.github.gjaku1031.kenblog.profile.repository.HomeProfileRepository
import java.io.InputStream
import java.net.URI
import java.time.LocalDateTime
import java.time.ZoneOffset
import org.springframework.data.repository.findByIdOrNull
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.multipart.MultipartFile

/** 홈 소개의 확정 텍스트와 OCI 프로필 사진을 관리. */
@Service
class HomeProfileService(
    private val profiles: HomeProfileRepository,
    private val images: ManagedImageNormalizer,
    private val storage: OciObjectStorage,
    manager: PlatformTransactionManager,
) {
    private val transactions = TransactionTemplate(manager)
    /** @return 저장된 공개 소개, 아직 저장하지 않았으면 빈 카드. */
    @Transactional(readOnly = true)
    fun get(): HomeProfileResponse = profiles.findByIdOrNull(1)?.response() ?: HomeProfileResponse("", "", "", "", "", null)

    /** @return 검증·저장된 홈 카드. 저장 전 브라우저 편집 상태에는 영향 없음. */
    @Transactional
    fun update(request: HomeProfileRequest): HomeProfileResponse {
        val clean = validate(request)
        val profile = profiles.findByIdOrNull(1) ?: HomeProfileEntity(now())
        profile.update(clean.name, clean.tagline, clean.intro, clean.github, clean.email, now())
        return profiles.saveAndFlush(profile).response()
    }

    /** 텍스트와 선택 사진을 단일 DB 트랜잭션에 확정하고 실패 시 새 OCI 객체를 제거. */
    fun save(request: HomeProfileRequest, file: MultipartFile?, removePhoto: Boolean): HomeProfileResponse {
        val clean = validate(request)
        if (file != null && removePhoto) badInput()
        val png = file?.let { images.normalize(it, 256) }
        val key = png?.let {
            storage.requireConfigured()
            storage.newKey("png").also { newKey ->
                storage.put(newKey, it, "image/png")
            }
        }
        return transactions.execute {
            if (key != null) cleanupOnRollback(key)
            val profile = profiles.findByIdOrNull(1) ?: HomeProfileEntity(now())
            profile.update(clean.name, clean.tagline, clean.intro, clean.github, clean.email, now())
            val previous = if (key != null || removePhoto) profile.replacePhoto(key, now()) else null
            val saved = profiles.saveAndFlush(profile).response()
            if (previous != null) cleanupAfterCommit(previous)
            saved
        } ?: error("프로필 저장 결과가 없습니다.")
    }

    /** 새 사진을 256×256 PNG로 저장해 텍스트와 독립적으로 교체. */
    fun uploadPhoto(file: MultipartFile): HomeProfileResponse {
        val png = images.normalize(file, 256)
        storage.requireConfigured()
        val key = storage.newKey("png")
        storage.put(key, png, "image/png")
        return transactions.execute {
            cleanupOnRollback(key)
            val profile = profiles.findByIdOrNull(1) ?: HomeProfileEntity(now())
            val previous = profile.replacePhoto(key, now())
            val saved = profiles.saveAndFlush(profile).response()
            if (previous != null) cleanupAfterCommit(previous)
            saved
        } ?: error("프로필 사진 저장 결과가 없습니다.")
    }

    /** 사진 참조를 먼저 없애고 커밋 뒤 OCI 객체를 제거. */
    @Transactional
    fun removePhoto(): HomeProfileResponse {
        val profile = profiles.findByIdOrNull(1) ?: return get()
        val previous = profile.replacePhoto(null, now())
        val saved = profiles.saveAndFlush(profile).response()
        if (previous != null) cleanupAfterCommit(previous)
        return saved
    }

    /** @return 저장된 공개 사진 PNG 스트림. 호출자가 닫아야 함. */
    @Transactional(readOnly = true)
    fun openPhoto(): InputStream {
        val key = profiles.findByIdOrNull(1)?.photoObjectKey
            ?: throw OperationFailure(HttpStatus.NOT_FOUND, "프로필 사진이 없습니다.")
        return storage.open(key)
    }

    /** @return object key 없이 공개할 카드 DTO. */
    private fun HomeProfileEntity.response(): HomeProfileResponse =
        HomeProfileResponse(name, tagline, intro, github, email, photoObjectKey?.let { "/api/v1/profile/photo?v=$updatedAt" })

    /** @return 모든 텍스트 필드를 단일 요청에서 검증·정리한 확정 입력. */
    private fun validate(request: HomeProfileRequest): HomeProfileRequest {
        val clean = HomeProfileRequest(field(request.name, 100), field(request.tagline, 240),
            field(request.intro, 5000, multiline = true), field(request.github, 500),
            email(request.email))
        if (clean.name.isBlank() ||
            (clean.github.isNotEmpty() && !isGithubUrl(clean.github))) badInput()
        return clean
    }

    /** @return 선택적인 공개 이메일. 제어문자·긴 주소·잘못된 형식은 명확한 400으로 거부. */
    private fun email(value: String): String {
        if (value.any(Character::isISOControl)) badEmail()
        return value.trim().also { if (it.length > 254 || (it.isNotEmpty() && !isEmail(it))) badEmail() }
    }

    /** @return 길이 제한과 ASCII dot-atom/local·DNS 도메인 형식을 만족하는 공개 이메일 여부. */
    private fun isEmail(value: String): Boolean {
        val parts = value.split('@')
        if (parts.size != 2 || parts[0].length !in 1..64 || parts[1].length !in 1..253 || !EMAIL_LOCAL.matches(parts[0])) return false
        val labels = parts[1].split('.')
        return labels.size >= 2 && labels.last().length >= 2 && labels.all { DOMAIN_LABEL.matches(it) }
    }

    /** @return 제어문자·길이가 검증된 단일 입력 필드. */
    private fun field(value: String, max: Int, multiline: Boolean = false): String = value.trim().also {
        if (it.length > max || it.any { c -> Character.isISOControl(c) && (!multiline || c != '\n') }) badInput()
    }

    /** @return 공개 GitHub HTTPS URL인지 여부. */
    private fun isGithubUrl(value: String): Boolean = runCatching { URI(value) }.getOrNull()?.let {
        it.scheme == "https" && it.host == "github.com" && it.userInfo == null && it.fragment == null
    } == true

    /** @return 현재 UTC DB 시각. */
    private fun now(): LocalDateTime = LocalDateTime.now(ZoneOffset.UTC)

    /** 저장 트랜잭션 실패 시 새 객체만 제거. */
    private fun cleanupOnRollback(key: String) {
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            /** DB 롤백 시 새 사진 객체를 보상 삭제. */
            override fun afterCompletion(status: Int) {
                if (status != TransactionSynchronization.STATUS_COMMITTED) runCatching { storage.delete(key) }
            }
        })
    }

    /** DB 커밋 이후 이전 객체를 제거. */
    private fun cleanupAfterCommit(key: String) {
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            /** DB 커밋 뒤 이전 사진 객체를 삭제. */
            override fun afterCommit() { runCatching { storage.delete(key) } }
        })
    }

    /** @return 안전한 홈 소개 입력 오류. */
    private fun badInput(): Nothing = throw OperationFailure(HttpStatus.BAD_REQUEST, "홈 소개 입력을 확인하세요.")

    /** @return 안전하고 이메일 필드를 특정하는 입력 오류. */
    private fun badEmail(): Nothing = throw OperationFailure(HttpStatus.BAD_REQUEST, "이메일 주소를 확인하세요.")

    private companion object {
        val EMAIL_LOCAL = Regex("[A-Za-z0-9!#\u0024%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#\u0024%&'*+/=?^_`{|}~-]+)*")
        val DOMAIN_LABEL = Regex("[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?")
    }
}
