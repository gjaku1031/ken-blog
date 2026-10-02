package io.github.gjaku1031.kenblog.post.dto

/** 제목으로 찾은 출간 글의 열람 상태. */
enum class WikiLinkStatus { READABLE, MISSING }

/**
 * 요청한 제목별 결과의 공통 계약.
 *
 * [WikiLinkReadable]에만 이동용 메타데이터가 있으며 미존재 결과에는 대상 정보가 없음.
 */
sealed interface WikiLinkResult {
    /** 앞뒤 공백을 제거한 요청 제목. 입력 순서와 중복은 응답에서 유지함. */
    val requestedTitle: String

    /** 읽기 가능·미존재를 구별하는 상태. */
    val status: WikiLinkStatus
}

/**
 * 현재 권한으로 읽을 수 있는 출간 글의 이동 정보.
 *
 * 본문·분류·태그·첨부 메타데이터는 조회하지 않음.
 */
data class WikiLinkReadable(
    override val requestedTitle: String,
    val id: Long,
    val title: String,
    val slug: String,
    val section: String = "TECH",
    val seriesSlug: String? = null,
) : WikiLinkResult {
    override val status = WikiLinkStatus.READABLE
}

/** 초안 또는 일치하는 출간 글이 없는 요청의 결과. */
data class WikiLinkMissing(
    override val requestedTitle: String,
) : WikiLinkResult {
    override val status = WikiLinkStatus.MISSING
}
