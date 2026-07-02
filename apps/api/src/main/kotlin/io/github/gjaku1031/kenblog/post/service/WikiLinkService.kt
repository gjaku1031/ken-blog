package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.post.domain.InvalidWikiLinkRequestException
import io.github.gjaku1031.kenblog.post.dto.WikiLinkLocked
import io.github.gjaku1031.kenblog.post.dto.WikiLinkMissing
import io.github.gjaku1031.kenblog.post.dto.WikiLinkReadable
import io.github.gjaku1031.kenblog.post.dto.WikiLinkResolveResponse
import io.github.gjaku1031.kenblog.post.dto.WikiLinkResult
import io.github.gjaku1031.kenblog.post.dto.WikiLinkTargetRow
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import java.nio.charset.StandardCharsets
import org.springframework.security.core.Authentication
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 반복 제목을 검증하고 한 DB 읽기 트랜잭션에서 최초 출간 글과 열람 상태를 결정.
 *
 * PRIVATE 잠금 결과에는 DB 메타데이터를 싣지 않고 제목별 SQL 조회는 최대 20번으로 제한함.
 */
@Service
class WikiLinkService(private val posts: PostRepository) {
    /**
     * 원래 요청 순서·중복을 유지하면서 제목을 조회.
     *
     * @param originals Servlet이 쉼표를 분리하지 않고 제공한 반복 title 값
     * @param rawQuery URL 인코딩된 원래 쿼리 문자열
     * @param authentication PRIVATE 열람 권한을 명시적 ROLE_USER·ROLE_ADMIN으로 판단할 인증
     * @return 대상별 READABLE·LOCKED·MISSING 결과
     * @throws InvalidWikiLinkRequestException 값 수·문자·길이·인코딩 길이가 잘못됐을 때
     */
    @Transactional(readOnly = true)
    fun resolve(originals: List<String>, rawQuery: String?, authentication: Authentication?): WikiLinkResolveResponse {
        if (originals.size !in 1..MAX_TITLES || rawQuery == null ||
            rawQuery.toByteArray(StandardCharsets.UTF_8).size > MAX_ENCODED_QUERY_BYTES) {
            throw InvalidWikiLinkRequestException()
        }
        var rawBytes = 0
        val titles = originals.map { original ->
            validateCharacters(original)
            rawBytes += original.toByteArray(StandardCharsets.UTF_8).size
            if (rawBytes > MAX_RAW_TITLE_BYTES) throw InvalidWikiLinkRequestException()
            original.trim().also { title ->
                if (title.codePointCount(0, title.length) !in 1..MAX_TITLE_CODEPOINTS) {
                    throw InvalidWikiLinkRequestException()
                }
            }
        }
        val includePrivate = authentication?.authorities?.any {
            it.authority == "ROLE_USER" || it.authority == "ROLE_ADMIN"
        } == true
        val found = mutableMapOf<String, WikiLinkTargetRow?>()
        val items: List<WikiLinkResult> = titles.map { title ->
            val target = if (found.containsKey(title)) found[title] else posts.findWikiLinkTarget(title).also { found[title] = it }
            when {
                target == null -> WikiLinkMissing(title)
                target.visibility == "PUBLIC" || (target.visibility == "PRIVATE" && includePrivate) ->
                    WikiLinkReadable(title, target.id, target.title, target.slug)
                else -> WikiLinkLocked(title)
            }
        }
        return WikiLinkResolveResponse(items)
    }

    /** 제어 문자·줄 구분자·짝 없는 UTF-16 surrogate를 SQL 조회 전에 거부. */
    private fun validateCharacters(value: String) {
        var offset = 0
        while (offset < value.length) {
            val codePoint = value.codePointAt(offset)
            if (Character.isISOControl(codePoint) || codePoint == 0x2028 || codePoint == 0x2029 ||
                codePoint in 0xD800..0xDFFF) throw InvalidWikiLinkRequestException()
            offset += Character.charCount(codePoint)
        }
    }

    private companion object {
        const val MAX_TITLES = 20
        const val MAX_TITLE_CODEPOINTS = 200
        const val MAX_RAW_TITLE_BYTES = 1500
        // title 값 1500바이트가 모두 %XX로 인코딩돼도 반복 키를 포함해 수용함.
        const val MAX_ENCODED_QUERY_BYTES = 6144
    }
}
