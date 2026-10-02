package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest
import io.github.gjaku1031.kenblog.post.service.PostService
import io.github.gjaku1031.kenblog.series.domain.InvalidSeriesRequestException
import io.github.gjaku1031.kenblog.series.dto.SeriesRequests
import io.github.gjaku1031.kenblog.series.service.SeriesService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.transaction.annotation.Transactional
import tools.jackson.databind.ObjectMapper
import java.util.UUID

/** 브라우저의 주소 없는 생성 요청과 기존 에이전트의 명시 주소를 실제 MySQL에서 검증. */
@SpringBootTest
@Import(TestMysqlConfig::class)
@Transactional
class SlugGenerationIntegrationTest(
    @Autowired private val posts: PostService,
    @Autowired private val series: SeriesService,
    @Autowired private val mapper: ObjectMapper,
) {
    @Test
    fun postsWithoutSlugReceiveDistinctStableAddresses() {
        val request = PostMetadataCreateRequest.fromJson(mapper.readTree("""{"title":"같은 제목"}"""))
        val first = posts.createMetadata(request)
        val second = posts.createMetadata(request)
        assertGenerated(first.slug, "post")
        assertGenerated(second.slug, "post")
        assertNotEquals(first.slug, second.slug)
        assertEquals(first.slug, posts.adminMetadata(first.id).slug)
        assertEquals(second.slug, posts.adminMetadata(second.id).slug)
    }

    @Test
    fun bothSeriesKindsReceiveUniqueAddressesWhenOmitted() {
        for ((kind, prefix, metadata) in listOf(
            Triple("TECH", "series", """{"name":"같은 시리즈"}"""),
            Triple("PROJECT", "project", """{"name":"같은 프로젝트","projectStatus":"PLAN","startPeriod":"2026.10"}"""),
        )) {
            val request = SeriesRequests.create(mapper.readTree("""{"kind":"$kind","metadata":$metadata}"""))
            val first = series.create(request)
            val second = series.create(request)
            assertGenerated(first.slug, prefix)
            assertGenerated(second.slug, prefix)
            assertNotEquals(first.slug, second.slug)
            assertEquals(first.slug, series.detail(first.id).series.slug)
            val post = posts.createMetadata(PostMetadataCreateRequest("첫 문서", seriesId = first.id, order = 1))
            assertEquals(first.id, post.series?.id)
            assertEquals(post.id, series.detail(first.id).posts.single().id)
        }
    }

    @Test
    fun explicitAddressesRemainSupportedAndNormalized() {
        val post = posts.createMetadata(PostMetadataCreateRequest.fromJson(mapper.readTree(
            """{"title":"기존 방식","slug":"  LEGACY-POST  "}""")))
        val group = series.create(SeriesRequests.create(mapper.readTree(
            """{"slug":"  LEGACY-SERIES  ","kind":"TECH","metadata":{"name":"기존 방식"}}""")))
        assertEquals("legacy-post", post.slug)
        assertEquals("legacy-series", group.slug)
    }

    @Test
    fun suppliedInvalidAddressesAndUnknownFieldsAreStillRejected() {
        for (slug in listOf("42", "true", "[]", "{}", "\"\"", "\"invalid slug\"")) {
            assertThrows<InvalidPostRequestException> {
                posts.createMetadata(PostMetadataCreateRequest.fromJson(mapper.readTree(
                    """{"title":"잘못된 주소","slug":$slug}""")))
            }
            assertThrows<InvalidSeriesRequestException> {
                series.create(SeriesRequests.create(mapper.readTree(
                    """{"kind":"TECH","metadata":{"name":"잘못된 주소"},"slug":$slug}""")))
            }
        }
        assertThrows<InvalidSeriesRequestException> {
            SeriesRequests.create(mapper.readTree("""{"kind":"TECH","metadata":{"name":"제목"},"unknown":true}"""))
        }
    }

    private fun assertGenerated(slug: String, prefix: String) {
        assertTrue(slug.startsWith("$prefix-"))
        assertEquals(slug.removePrefix("$prefix-"), UUID.fromString(slug.removePrefix("$prefix-")).toString())
    }
}
