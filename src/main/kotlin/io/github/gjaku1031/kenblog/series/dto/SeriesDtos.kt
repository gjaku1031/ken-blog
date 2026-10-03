package io.github.gjaku1031.kenblog.series.dto

import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.PostSeriesItem
import io.github.gjaku1031.kenblog.series.domain.*
import io.github.gjaku1031.kenblog.stack.dto.StackBadgeResponse
import java.time.LocalDateTime
import tools.jackson.databind.JsonNode

/**
 * 목록과 관리자 편집에 사용하는 시리즈 속성
 * cover는 첫 출간 문서에서 계산
 */
data class SeriesResponse(
    /**
     * ID
     */
    val id: Long,

    /**
     * 공개 주소 식별자
     */
    val slug: String,

    /**
     * 이름
     */
    val name: String,

    /**
     * 시리즈 종류
     */
    val kind: SeriesKind,

    /**
     * 설명
     */
    val description: String,

    /**
     * 공개 범위
     */
    val visibility: PostVisibility,

    /**
     * 프로젝트 진행 상태
     */
    val projectStatus: ProjectStatus?,

    /**
     * 시작 연월
     */
    val startPeriod: String?,

    /**
     * 종료 연월
     */
    val endPeriod: String?,

    /**
     * 정렬 순서
     */
    val sortOrder: Long,

    /**
     * 수정 시각
     */
    val updatedAt: LocalDateTime,

    /**
     * 첫 출간 문서, 없으면 null
     */
    val cover: PostSeriesItem?,

    /**
     * 문서 수
     */
    val postCount: Int,

    /**
     * 선택 순서의 기술 뱃지 목록
     */
    val stackBadges: List<StackBadgeResponse>,
)

/**
 * 본문 없는 시리즈 메타데이터와 같은 규칙으로 정렬한 글 목록
 */
data class SeriesDetailResponse(
    /**
     * 시리즈
     */
    val series: SeriesResponse,

    /**
     * 시리즈 문서 목록
     */
    val posts: List<SeriesPostResponse>
    )

/**
 * 관리자에게는 미출간 문서도 포함하며 공개 상세에는 출간 문서만 포함
 */
data class SeriesPostResponse(
    /**
     * ID
     */
    val id: Long,

    /**
     * 제목
     */
    val title: String,

    /**
     * 공개 주소 식별자
     */
    val slug: String,

    /**
     * 표시 순서
     */
    val order: Int?,

    /**
     * 공개 출간 여부
     */
    val published: Boolean
    )

/**
 * 변경할 시리즈 속성
 * 종류와 주소 변경은 허용하지 않음
 */
data class SeriesMetadataRequest(
    /**
     * 이름
     */
    val name: String,

    /**
     * 설명
     */
    val description: String = "",

    /**
     * 프로젝트 진행 상태
     */
    val projectStatus: ProjectStatus? = null,

    /**
     * 시작 연월
     */
    val startPeriod: String? = null,

    /**
     * 종료 연월
     */
    val endPeriod: String? = null,

    /**
     * 선택한 기술 이름 목록
     */
    val stackBadgeNames: List<String> = emptyList(),

    /**
     * 수정 충돌 확인용 기존 수정 시각
     */
    val baseUpdatedAt: LocalDateTime? = null,
)

/**
 * 시리즈 생성은 문서 생성과 독립적이며 첫 출간 전에는 공개 목록에 나오지 않음
 */
data class SeriesCreateRequest(
    /**
     * 공개 주소 식별자, 생략하면 서버에서 생성
     */
    val slug: String? = null,

    /**
     * 시리즈 종류
     */
    val kind: SeriesKind,

    /**
     * 시리즈 속성 입력
     */
    val metadata: SeriesMetadataRequest
    )

/**
 * JSON 타입·문자열·기간·종류별 메타데이터를 검사
 */
object SeriesRequests {
    /**
     * 시리즈 속성 JSON의 허용 필드·타입 검사
     *
     * 1. 허용 키와 프로젝트 상태 값 검사
     * 2. 기술 이름 배열의 크기·타입 검사
     * 3. 수정 시각을 파싱하고 시리즈 속성 입력 구성
     */
    fun metadata(node: JsonNode): SeriesMetadataRequest {
        // 허용 키와 프로젝트 상태 값 검사
        val allowed = setOf("name", "description", "projectStatus", "startPeriod", "endPeriod", "stackBadgeNames", "baseUpdatedAt")
        if (!node.isObject || node.properties().any { it.key !in allowed }) throw InvalidSeriesRequestException()
        val status = optionalText(node, "projectStatus")?.let { value ->
            ProjectStatus.entries.firstOrNull { it.name == value } ?: throw InvalidSeriesRequestException()
        }
        // 기술 이름 배열의 크기·타입 검사
        val badges = node.get("stackBadgeNames")?.let {
            if (!it.isArray || it.size() > 30) throw InvalidSeriesRequestException()
            (0 until it.size()).map { index ->
                if (!it[index].isString) throw InvalidSeriesRequestException()
                it[index].stringValue()
            }
        } ?: emptyList()
        // 수정 시각을 파싱하고 시리즈 속성 입력 구성
        val base = optionalText(node, "baseUpdatedAt")?.let {
            try { LocalDateTime.parse(it) } catch (_: java.time.format.DateTimeParseException) { throw InvalidSeriesRequestException() }
        }
        return SeriesMetadataRequest(optionalText(node, "name") ?: throw InvalidSeriesRequestException(),
            optionalText(node, "description") ?: "", status, optionalText(node, "startPeriod"),
            optionalText(node, "endPeriod"), badges, base)
    }

    /**
     * 시리즈 생성
     *
     * 1. 허용 키와 종류·메타데이터 필수 입력 검사
     * 2. 주소 생략을 허용하고 종류별 메타데이터 검증
     */
    fun create(node: JsonNode): SeriesCreateRequest {
        // 허용 키와 종류·메타데이터 필수 입력 검사
        val allowed = setOf("slug", "kind", "metadata")
        if (!node.isObject || node.properties().any { it.key !in allowed } || !node.path("kind").isString || !node.has("metadata"))
            throw InvalidSeriesRequestException()
        val kind = SeriesKind.entries.firstOrNull { it.name == node.get("kind").stringValue() }
            ?: throw InvalidSeriesRequestException()
        // 주소 생략을 허용하고 종류별 메타데이터 검증
        return SeriesCreateRequest(optionalText(node, "slug"), kind, metadata(node.get("metadata")))
    }

    /**
     * 종류별 속성·기술 목록·기간 범위 검사
     *
     * 1. 공백 정리 후 이름·설명 길이와 제어 문자 검사
     * 2. TECH의 프로젝트 전용 값 거부, PROJECT는 상태·기간 필수 검사
     * 3. 정규화한 이름·설명으로 입력 반환
     */
    fun validate(kind: SeriesKind, input: SeriesMetadataRequest): SeriesMetadataRequest {
        // 공백 정리 후 이름·설명 길이와 제어 문자 검사
        val name = input.name.trim(); val description = input.description.trim()
        if (name.isBlank() || name.codePointCount(0, name.length) > 200 || description.codePointCount(0, description.length) > 1000 ||
            name.any(Char::isISOControl) || description.any { Character.isISOControl(it) && it != '\n' && it != '\t' })
            throw InvalidSeriesRequestException()
        // TECH의 프로젝트 전용 값 거부, PROJECT는 상태·기간 필수 검사
        if (kind == SeriesKind.TECH) {
            if (input.projectStatus != null || input.startPeriod != null || input.endPeriod != null || input.stackBadgeNames.isNotEmpty())
                throw InvalidSeriesRequestException()
        } else {
            val start = input.startPeriod ?: throw InvalidSeriesRequestException()
            if (input.projectStatus == null || !PERIOD.matches(start) || start.startsWith("0000") ||
                input.endPeriod?.let { !PERIOD.matches(it) || it.startsWith("0000") || it < start } == true)
                throw InvalidSeriesRequestException()
        }
        // 정규화한 이름·설명으로 입력 반환
        return input.copy(name = name, description = description)
    }

    /**
     * 선택 문자열의 null·타입 검사
     */
    private fun optionalText(node: JsonNode, name: String): String? = node.get(name)?.let {
        if (it.isNull) null else if (it.isString) it.stringValue() else throw InvalidSeriesRequestException()
    }

    /**
     * 연월 입력 패턴
     */
    private val PERIOD = Regex("[0-9]{4}\\.(0[1-9]|1[0-2])")
}
