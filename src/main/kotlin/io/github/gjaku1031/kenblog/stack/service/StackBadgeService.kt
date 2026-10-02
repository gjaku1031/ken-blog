package io.github.gjaku1031.kenblog.stack.service

import io.github.gjaku1031.kenblog.attachment.storage.LocalAssetStorage
import io.github.gjaku1031.kenblog.global.error.BusinessException
import io.github.gjaku1031.kenblog.series.repository.SeriesRepository
import io.github.gjaku1031.kenblog.stack.domain.SeriesStackBadgeEntity
import io.github.gjaku1031.kenblog.stack.domain.StackBadgeEntity
import io.github.gjaku1031.kenblog.stack.dto.StackBadgeResponse
import io.github.gjaku1031.kenblog.stack.repository.SeriesStackBadgeRepository
import io.github.gjaku1031.kenblog.stack.repository.StackBadgeRepository
import java.io.InputStream
import java.util.Locale
import org.springframework.data.repository.findByIdOrNull
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 로컬 아이콘과 프로젝트의 뱃지 선택을 ID로 관리하는 구체 서비스. */
@Service
class StackBadgeService(
    private val badges: StackBadgeRepository,
    private val links: SeriesStackBadgeRepository,
    private val projects: SeriesRepository,
    private val storage: LocalAssetStorage,
) {
    /** [StackBadgeEntity.id] 등록순으로 관리자에게 프로젝트 선택용 목록을 전달. */
    @Transactional(readOnly = true)
    fun listAdmin(): List<StackBadgeResponse> = badges.findAll().sortedBy { it.id ?: Long.MAX_VALUE }.map { it.response() }

    /** @return 프로젝트 출간 속성에서 사용할 선택 순서의 뱃지 목록. */
    @Transactional(readOnly = true)
    fun listForSeries(seriesId: Long): List<StackBadgeResponse> = links.findByIdSeriesIdOrderBySortOrder(seriesId).mapNotNull {
        badges.findByIdOrNull(it.id.badgeId)?.response()
    }

    /**
     * 프로젝트 대문의 이름 배열을 등록된 ID 연결로 교체.
     *
     * @throws BusinessException 없는 프로젝트나 등록되지 않은 이름·중복 입력일 때
     */
    @Transactional
    fun replaceSeriesStack(seriesId: Long, names: List<String>) {
        if (seriesId <= 0 || projects.findByIdOrNull(seriesId)?.kind != io.github.gjaku1031.kenblog.series.domain.SeriesKind.PROJECT || names.size > 30) badInput()
        val selected = names.map { name ->
            val key = nameKey(name)
            badges.findByNameKey(key) ?: badInput()
        }
        if (selected.map { it.id }.toSet().size != selected.size) badInput()
        links.deleteByIdSeriesId(seriesId)
        links.flush()
        links.saveAllAndFlush(selected.mapIndexed { index, badge ->
            SeriesStackBadgeEntity(seriesId, badge.id ?: error("Persisted badge has no ID"), index)
        })
    }

    /** @return 등록된 뱃지의 공개 PNG 스트림. 호출자가 닫아야 함. */
    @Transactional(readOnly = true)
    fun openImage(id: Long): InputStream = storage.open(badge(id).objectKey)

    /** @return 내부 저장 키를 제외한 이름과 공개 URL DTO. */
    private fun StackBadgeEntity.response(): StackBadgeResponse {
        val key = id ?: error("Persisted badge has no ID")
        return StackBadgeResponse(key, name, "/api/v1/stack-badges/$key/image?v=$updatedAt")
    }

    /** @return 존재하는 뱃지 또는 고정 404. */
    private fun badge(id: Long): StackBadgeEntity =
        (if (id > 0) badges.findByIdOrNull(id) else null)
            ?: throw BusinessException(HttpStatus.NOT_FOUND, "기술 뱃지를 찾을 수 없습니다.")

    /** @return 길이와 제어문자를 검증한 표시 이름. */
    private fun displayName(value: String): String = value.trim().also {
        if (it.isBlank() || it.length > 100 || it.any(Char::isISOControl)) badInput()
    }

    /** @return 중복 비교용 소문자 이름. */
    private fun nameKey(value: String): String = displayName(value).lowercase(Locale.ROOT)

    /** @return 입력 실패의 안전한 400. */
    private fun badInput(): Nothing = throw BusinessException(HttpStatus.BAD_REQUEST, "기술 뱃지 입력을 확인하세요.")

}
