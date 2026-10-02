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

/** 동일 MySQL 일관 읽기에서 공통 공개 메타데이터와 첨부 revision을 생성. */
@Service
class PagesSnapshotService(private val posts: PublicPostService, private val series: SeriesService,

    private val queries: PostQueries, private val mapper: ObjectMapper) {
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun snapshot(): Map<String, Any?> {
        val rows = mutableListOf<PublicPostDetailResponse>()
        var page = 0
        do {
            val result = queries.publicPage(page++, 100)
            check(result.pages <= 10_000) { "Public snapshot too large" }
            rows += result.items.map { posts.detailMetadata(it.slug) }
        } while (page < result.pages)
        val payload = linkedMapOf<String, Any?>("version" to 2,
            "posts" to rows, "series" to series.list(false))
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(mapper.writeValueAsBytes(payload)); digest.update(0)
        queries.attachmentRevisions().forEach { digest.update(it.toByteArray(Charsets.UTF_8)); digest.update(0) }
        payload["revision"] = HexFormat.of().formatHex(digest.digest())
        return payload
    }
}
