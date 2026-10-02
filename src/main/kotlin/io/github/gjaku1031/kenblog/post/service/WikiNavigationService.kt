package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.post.domain.InvalidWikiLinkRequestException
import io.github.gjaku1031.kenblog.post.dto.WikiLinkMissing
import io.github.gjaku1031.kenblog.post.dto.WikiLinkReadable
import io.github.gjaku1031.kenblog.post.dto.WikiTitleSearchResponse
import io.github.gjaku1031.kenblog.post.dto.navigationItem
import io.github.gjaku1031.kenblog.post.repository.PostQueries
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 본문 없이 공개 제목 대표 검색을 수행하는 관리자 서비스. */
@Service
class WikiNavigationService(private val posts: PostQueries) {
    /**
     * ADMIN 입력의 실제 부분 문자열 후보와 동일 제목 정확 해석을 본문 없이 반환.
     * @throws InvalidWikiLinkRequestException 길이·제어 문자가 잘못됐을 때
     */
    @Transactional(readOnly = true)
    fun titleSearch(raw: String?): WikiTitleSearchResponse {
        val query = raw?.trim() ?: throw InvalidWikiLinkRequestException()
        if (query.codePointCount(0, query.length) !in 1..200) throw InvalidWikiLinkRequestException()
        var offset = 0
        while (offset < query.length) {
            val codePoint = query.codePointAt(offset)
            if (Character.isISOControl(codePoint) || codePoint == 0x2028 || codePoint == 0x2029 ||
                codePoint in 0xD800..0xDFFF) throw InvalidWikiLinkRequestException()
            offset += Character.charCount(codePoint)
        }
        val exact = posts.wikiTarget(query)?.let {
            WikiLinkReadable(query, it.id, it.title, it.slug, it.series?.kind?.name ?: "TECH", it.series?.slug)
        }
            ?: WikiLinkMissing(query)
        return WikiTitleSearchResponse(posts.titleSearch(query).map { it.navigationItem() }, exact)
    }

}
