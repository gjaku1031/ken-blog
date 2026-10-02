package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.post.domain.InvalidWikiLinkRequestException
import tools.jackson.databind.JsonNode

/** 관리자 명시적 위키 대상 선언을 JSON 강제 변환 없이 읽고 정규화함. */
object WikiDeclarations {
    /**
     * @param node 선택적 배열 또는 null; 생략과 null은 호출자가 기존 연결 처리에 사용
     * @return 입력 순서로 중복 제거한 제목, 생략·null이면 null
     * @throws InvalidWikiLinkRequestException 항목 수·타입·제목 문자가 잘못됐을 때
     */
    fun parse(node: JsonNode?): List<String>? {
        if (node == null || node.isNull) return null
        if (!node.isArray || node.size() > MAX_TARGETS) throw InvalidWikiLinkRequestException()
        val titles = LinkedHashSet<String>()
        for (index in 0 until node.size()) {
            val value = node.get(index)
            if (!value.isTextual) throw InvalidWikiLinkRequestException()
            titles.add(title(value.textValue()))
        }
        return titles.toList()
    }

    /** @return 위키 문법에서 허용되는 1~200 codepoint 제목의 양끝 공백 제거 결과. */
    fun title(raw: String): String {
        val normalized = raw.trim()
        if (normalized.codePointCount(0, normalized.length) !in 1..200 || normalized.any { it == '[' || it == ']' || it == '|' }) {
            throw InvalidWikiLinkRequestException()
        }
        var offset = 0
        while (offset < normalized.length) {
            val codePoint = normalized.codePointAt(offset)
            if (Character.isISOControl(codePoint) || codePoint == 0x2028 || codePoint == 0x2029 ||
                codePoint in 0xD800..0xDFFF) throw InvalidWikiLinkRequestException()
            offset += Character.charCount(codePoint)
        }
        return normalized
    }

    /** @return 배열을 필수로 요구한 보정 API의 선언; null·생략은 400. */
    fun required(node: JsonNode?): List<String> = parse(node) ?: throw InvalidWikiLinkRequestException()

    /** @return 내부 서비스 호출에도 동일한 수·제목 제한을 적용한 중복 없는 선언. */
    fun normalized(titles: List<String>): List<String> {
        if (titles.size > MAX_TARGETS) throw InvalidWikiLinkRequestException()
        return titles.map(::title).distinct()
    }

    private const val MAX_TARGETS = 128
}

/** 관리자 제목 검색의 본문 없는 게시글 이동 정보. */
data class WikiNavigationItem(
    val id: Long,
    val title: String,
    val slug: String,
    val section: String = "TECH",
    val seriesSlug: String? = null,
    val seriesName: String? = null,
)

/** 관리자 부분 제목 검색과 동일 입력의 정확한 위키 해석. */
data class WikiTitleSearchResponse(
    val items: List<WikiNavigationItem>,
    val exact: WikiLinkResult,
)

/** 원고와 독립적으로 위키 대상 선언 전체를 교체하는 관리자 입력. */
data class WikiLinkCorrectionRequest(
    val wikiTargets: List<String>,
) {
    companion object {
        /** @return 필수 제목 배열만 허용한 요청. 이전 본문 해시 필드도 묵시적으로 무시하지 않고 거부. */
        fun fromJson(node: JsonNode): WikiLinkCorrectionRequest {
            if (!node.isObject || node.size() != 1 || !node.has("wikiTargets")) throw InvalidWikiLinkRequestException()
            return WikiLinkCorrectionRequest(WikiDeclarations.required(node.get("wikiTargets")))
        }
    }
}

/** 공통 조회 행의 공개 이동 정보. */
fun io.github.gjaku1031.kenblog.post.repository.PostRow.navigationItem() = WikiNavigationItem(
    id, title, slug, series?.kind?.name ?: "TECH", series?.slug, series?.name)
