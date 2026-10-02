package io.github.gjaku1031.kenblog.pages

import io.github.gjaku1031.kenblog.post.service.PublicPostService
import io.github.gjaku1031.kenblog.post.dto.PublicPostDetailResponse
import io.github.gjaku1031.kenblog.post.repository.PostQueries
import io.github.gjaku1031.kenblog.series.service.SeriesService
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Isolation
import org.springframework.transaction.annotation.Transactional
import tools.jackson.databind.ObjectMapper
import java.security.MessageDigest
import java.util.HexFormat

/**
 * 동일 MySQL 일관 읽기에서 공통 공개 메타데이터와 첨부 revision을 생성
 */
@Service
class PagesSnapshotService(
    /**
     * 공개 글 메타데이터 서비스
     */
    private val posts: PublicPostService,
    /**
     * 시리즈 서비스
     */
    private val series: SeriesService,

    /**
     * 게시글 메타데이터 조회기
     */
    private val queries: PostQueries,
    /**
     * JSON 직렬화기
     */
    private val mapper: ObjectMapper
) {
    /**
     * 공개 메타데이터 스냅샷 조회
     *
     * 1. 같은 읽기 트랜잭션에서 모든 공개 글을 페이지 단위 수집
     * 2. 공개 글·시리즈로 스냅샷 본문 구성
     * 3. 메타데이터와 첨부 상태로 revision 계산, Git 원고는 제외
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun snapshot(): Map<String, Any?> {
        // 같은 읽기 트랜잭션에서 모든 공개 글을 페이지 단위 수집
        val rows = mutableListOf<PublicPostDetailResponse>()
        var page = 0
        do {
            val result = queries.publicPage(page++, 100)
            check(result.pages <= 10_000) { "Public snapshot too large" }
            rows += result.items.map { posts.detailMetadata(it.slug) }
        } while (page < result.pages)
        // 공개 글·시리즈로 스냅샷 본문 구성
        val payload = linkedMapOf<String, Any?>("version" to 2,
            "posts" to rows, "series" to series.list(false))
        // 메타데이터와 첨부 상태로 revision 계산, Git 원고는 제외
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(mapper.writeValueAsBytes(payload)); digest.update(0)
        queries.attachmentRevisions().forEach { digest.update(it.toByteArray(Charsets.UTF_8)); digest.update(0) }
        payload["revision"] = HexFormat.of().formatHex(digest.digest())
        return payload
    }
}
