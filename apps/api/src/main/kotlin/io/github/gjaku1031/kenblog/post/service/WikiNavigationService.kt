package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.InvalidWikiLinkRequestException
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.dto.WikiBacklinkPageResponse
import io.github.gjaku1031.kenblog.post.dto.WikiLinkMissing
import io.github.gjaku1031.kenblog.post.dto.WikiLinkReadable
import io.github.gjaku1031.kenblog.post.dto.WikiTitleSearchResponse
import io.github.gjaku1031.kenblog.post.dto.navigationItem
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import java.util.Locale
import org.springframework.security.core.Authentication
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 본문 없이 제목 대표 검색과 현재 권한의 저장된 역링크를 읽는 서비스. */
@Service
class WikiNavigationService(private val posts: PostRepository) {
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
        val exact = posts.findWikiLinkTarget(query)?.let { WikiLinkReadable(query, it.id, it.title, it.slug) }
            ?: WikiLinkMissing(query)
        return WikiTitleSearchResponse(posts.searchCanonicalTitles(query).map { it.navigationItem() }, exact)
    }

    /**
     * 현재 canonical 출간 글의 공개 가능 출처만 10개씩 조회하고 11번째 행으로 hasMore 판정.
     * 익명 PRIVATE 대상은 404로 숨기며 출처 PRIVATE 본문·건수는 SQL에서 제외함.
     * @throws PostNotFoundException 없는 글·초안·읽기 불가 대상일 때
     * @throws InvalidPostRequestException 페이지가 SQL 범위를 넘을 때
     */
    @Transactional(readOnly = true)
    fun backlinks(slug: String, page: Int, authentication: Authentication?): WikiBacklinkPageResponse {
        if (page < 0 || page.toLong() * PAGE_SIZE > Int.MAX_VALUE) throw InvalidPostRequestException()
        val normalizedSlug = slug.trim().lowercase(Locale.ROOT)
        if (normalizedSlug.length > 160 || !SLUG_PATTERN.matches(normalizedSlug)) throw PostNotFoundException()
        val target = posts.findPublishedWikiTargetBySlug(normalizedSlug) ?: throw PostNotFoundException()
        val includePrivate = authentication?.authorities?.any {
            it.authority == "ROLE_USER" || it.authority == "ROLE_ADMIN"
        } == true
        if (target.visibility != "PUBLIC" && !includePrivate) throw PostNotFoundException()
        val canonical = posts.findWikiLinkTarget(target.title)
        if (canonical?.id != target.id) return WikiBacklinkPageResponse(emptyList(), page, false)
        val rows = posts.findBacklinkRows(target.id, target.title, includePrivate, page * PAGE_SIZE)
        return WikiBacklinkPageResponse(rows.take(PAGE_SIZE).map { it.navigationItem() }, page, rows.size > PAGE_SIZE)
    }

    private companion object {
        const val PAGE_SIZE = 10
        val SLUG_PATTERN = Regex("[a-z0-9]+(?:-[a-z0-9]+)*")
    }
}
