package io.github.gjaku1031.kenblog.pages

import io.github.gjaku1031.kenblog.post.service.PublicPostService
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
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
     * 공개 글에서 사용하는 분류의 표시 이름·순서 조회
     */
    private val categories: CategoryRepository,

    /**
     * JSON 직렬화기
     */
    private val mapper: ObjectMapper
) {
    /**
     * 공개 메타데이터 스냅샷 조회
     *
     * 1. 같은 읽기 트랜잭션에서 전체 공개 행과 분류·태그 일괄 수집
     * 2. 공개 글·시리즈로 스냅샷 본문 구성
     * 3. 메타데이터와 첨부 상태로 revision 계산, Git 원고는 제외
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun snapshot(): Map<String, Any?> {
        // 전체 행을 한 번 읽고 분류·태그·탐색을 일괄 결합
        val source = queries.snapshotRows(true)
        val rows = posts.batch(source)
        // 공개 글·시리즈로 스냅샷 본문 구성
        // 공개 글의 분류와 그 부모만 포함, 빈 분류와 비공개 글 전용 분류 제외
        val paths = rows.mapNotNull { it.category?.path }.flatMap { listOf(it, it.substringBefore('/')) }.toSet()
        val publicCategories = categories.findAllByOrderByDepthAscSortOrderAscIdAsc()
            .filter { it.path in paths }
            .map { linkedMapOf("id" to it.id, "path" to it.path, "name" to it.name,
                "depth" to it.depth, "sortOrder" to it.sortOrder) }
        // 탐색 목록은 그룹마다 한 번만 직렬화하여 큰 시리즈의 이차 크기 증가 방지
        val navigation = linkedMapOf<String, Any>()
        val compact = rows.map { row ->
            val group = row.series?.let {
                val key = it.slug
                navigation.putIfAbsent(key, it.items)
                linkedMapOf("id" to it.id, "slug" to it.slug, "name" to it.name, "kind" to it.kind,
                    "position" to it.position, "navigationKey" to key)
            }
            linkedMapOf("id" to row.id, "title" to row.title, "slug" to row.slug, "summary" to row.summary,
                "publishedDate" to row.publishedDate, "section" to row.section, "category" to row.category,
                "tags" to row.tags, "series" to group, "relatedSeries" to row.relatedSeries,
                "legacyPath" to row.legacyPath, "publishedAt" to row.publishedAt)
        }
        val payload = linkedMapOf<String, Any?>("version" to 3, "posts" to compact, "navigation" to navigation,
            "series" to series.publicSnapshot(source), "categories" to publicCategories)
        // 메타데이터와 첨부 상태로 revision 계산, Git 원고는 제외
        val digest = MessageDigest.getInstance("SHA-256")
        val bytes = mapper.writeValueAsBytes(payload)
        check(bytes.size <= 7_999_800) { "Public snapshot exceeds capture limit" }
        digest.update(bytes); digest.update(0)
        queries.attachmentRevisions().forEach { digest.update(it.toByteArray(Charsets.UTF_8)); digest.update(0) }
        payload["revision"] = HexFormat.of().formatHex(digest.digest())
        return payload
    }
}
