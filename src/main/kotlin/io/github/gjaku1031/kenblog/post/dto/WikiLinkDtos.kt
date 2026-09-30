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
    /** 실제 글의 소속 구획. */
    val section: String = "TECH",
    /** 프로젝트 문서·대문만 이동 가능한 부모 주소. */
    val projectSlug: String? = null,
    val courseSlug: String? = null,
) : WikiLinkResult {
    override val status = WikiLinkStatus.READABLE
}

/** 초안 또는 일치하는 출간 글이 없는 요청의 결과. */
data class WikiLinkMissing(
    override val requestedTitle: String,
) : WikiLinkResult {
    override val status = WikiLinkStatus.MISSING
}

/** 반복 title 입력과 같은 순서의 위키 링크 대상 결과. */
data class WikiLinkResolveResponse(
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
    val section: String
    val projectSlug: String?
    val courseSlug: String?
    val projectVisibility: String?
    val homeVisibility: String?
}
