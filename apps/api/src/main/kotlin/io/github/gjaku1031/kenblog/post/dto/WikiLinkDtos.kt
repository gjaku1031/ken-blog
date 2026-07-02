package io.github.gjaku1031.kenblog.post.dto

import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.media.DiscriminatorMapping

/** 제목으로 찾은 출간 글의 열람 상태. */
enum class WikiLinkStatus { READABLE, LOCKED, MISSING }

/**
 * 요청한 제목별 결과의 공통 계약.
 *
 * [WikiLinkReadable]에만 이동용 메타데이터가 있으며 잠금·미존재 결과에는 대상 정보가 없음.
 */
@Schema(
    oneOf = [WikiLinkReadable::class, WikiLinkLocked::class, WikiLinkMissing::class],
    discriminatorProperty = "status",
    discriminatorMapping = [
        DiscriminatorMapping(value = "READABLE", schema = WikiLinkReadable::class),
        DiscriminatorMapping(value = "LOCKED", schema = WikiLinkLocked::class),
        DiscriminatorMapping(value = "MISSING", schema = WikiLinkMissing::class),
    ],
    requiredProperties = ["requestedTitle", "status"],
)
sealed interface WikiLinkResult {
    /** 앞뒤 공백을 제거한 요청 제목. 입력 순서와 중복은 응답에서 유지함. */
    val requestedTitle: String

    /** 읽기 가능·잠금·미존재를 구별하는 상태. */
    val status: WikiLinkStatus
}

/**
 * 현재 권한으로 읽을 수 있는 출간 글의 이동 정보.
 *
 * 본문·분류·태그·첨부 메타데이터는 조회하지 않음.
 */
data class WikiLinkReadable(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"])
    override val requestedTitle: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["integer"], format = "int64")
    val id: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"])
    val title: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"])
    val slug: String,
) : WikiLinkResult {
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"],
        allowableValues = ["READABLE"], accessMode = Schema.AccessMode.READ_ONLY)
    override val status = WikiLinkStatus.READABLE
}

/** 익명에게 비공개 출간 글의 존재만 알리고 대상 메타데이터를 숨긴 결과. */
data class WikiLinkLocked(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"])
    override val requestedTitle: String,
) : WikiLinkResult {
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"],
        allowableValues = ["LOCKED"], accessMode = Schema.AccessMode.READ_ONLY)
    override val status = WikiLinkStatus.LOCKED
}

/** 초안 또는 일치하는 출간 글이 없는 요청의 결과. */
data class WikiLinkMissing(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"])
    override val requestedTitle: String,
) : WikiLinkResult {
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["string"],
        allowableValues = ["MISSING"], accessMode = Schema.AccessMode.READ_ONLY)
    override val status = WikiLinkStatus.MISSING
}

/** 반복 title 입력과 같은 순서의 위키 링크 대상 결과. */
data class WikiLinkResolveResponse(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, types = ["array"])
    val items: List<WikiLinkResult>,
)

/**
 * SQL의 본문 없는 한 행을 담는 Spring Data 네이티브 투영.
 *
 * status는 WHERE 절에서 출간으로 제한하며 visibility는 DB의 대문자 값으로 읽음.
 */
interface WikiLinkTargetRow {
    val id: Long
    val title: String
    val slug: String
    val visibility: String
}
