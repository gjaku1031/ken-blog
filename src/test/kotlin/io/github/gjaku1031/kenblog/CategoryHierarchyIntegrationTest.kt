package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException
import io.github.gjaku1031.kenblog.category.service.CategoryService
import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest
import io.github.gjaku1031.kenblog.post.service.PostService
import io.github.gjaku1031.kenblog.post.service.PublicPostService
import io.github.gjaku1031.kenblog.pages.PagesSnapshotService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.annotation.Transactional

/**
 * 대분류·소분류 생성과 소분류 내 공개 문서 탐색의 MySQL 계약
 */
@SpringBootTest
@Import(TestMysqlConfig::class)
@Transactional
class CategoryHierarchyIntegrationTest(
    /**
     * 분류 저장소
     */
    @Autowired private val categories: CategoryService,

    /**
     * 시리즈 문서 목록
     */
    @Autowired private val posts: PostService,

    /**
     * 공개 글 메타데이터 서비스
     */
    @Autowired private val publicPosts: PublicPostService,

    /**
     * 공개 스냅샷과 분류 revision 조회
     */
    @Autowired private val pages: PagesSnapshotService,

    /**
     * JDBC 쿼리 실행기
     */
    @Autowired private val jdbc: JdbcTemplate,
) {
    /**
     * 대분류 재사용과 소분류 생성·깊이 검증
     */
    @Test
    fun createsTwoLevelsAndReusesTheirParent() {
        val first = categories.create(" Math / Linear Algebra ")
        val second = categories.create("Math/Probability")
        val root = categories.tree().single { it.path == "math" }
        assertEquals(1, root.depth)
        assertEquals(listOf(first.id, second.id), root.children.map { it.id })
        assertEquals(listOf("math/linear-algebra", "math/probability"), root.children.map { it.path })
        assertTrue(root.children.all { it.depth == 2 && it.children.isEmpty() })
    }

    /**
     * 3단계 입력을 저장 전에 거부하고 부모도 생성하지 않음 검증
     */
    @Test
    fun rejectsDeeperPathsBeforeCreatingAnyParent() {
        val before = jdbc.queryForObject("SELECT COUNT(*) FROM categories", Int::class.java)
        for (path in listOf("New/Child/Leaf", "New/Child/Leaf/Fourth")) {
            assertThrows<InvalidCategoryRequestException> { categories.create(path) }
        }
        assertEquals(before, jdbc.queryForObject("SELECT COUNT(*) FROM categories", Int::class.java))
    }

    /**
     * 소분류 탐색의 글 순서와 미발행 글 제외 검증
     */
    @Test
    fun secondLevelNavigationKeepsOrderAndExcludesDrafts() {
        val category = categories.create("Math/Linear Algebra")
        val second = posts.createMetadata(PostMetadataCreateRequest("두 번째", categoryId = category.id, order = 2))
        val first = posts.createMetadata(PostMetadataCreateRequest("첫 번째", categoryId = category.id, order = 1))
        posts.createMetadata(PostMetadataCreateRequest("초안", categoryId = category.id, order = 3))
        posts.setPublished(second.id, true)
        posts.setPublished(first.id, true)
        val detail = publicPosts.detailMetadata(second.slug)
        val navigation = requireNotNull(detail.series)
        assertEquals(2, detail.category?.depth)
        assertEquals(category.id, navigation.id)
        assertEquals(listOf(first.id, second.id), navigation.items.map { it.id })
        assertEquals(2, navigation.position)
        val root = categories.tree().single { it.path == "math" }
        assertEquals(3L, root.totalCount)
        assertEquals(3L, root.children.single().directCount)
    }

    /**
     * 대분류만 연결한 글에는 자동 탐색 시리즈가 생기지 않음 검증
     */
    @Test
    fun topLevelDoesNotCreateAnAutomaticReadingSeries() {
        val root = categories.create("Math")
        val post = posts.createMetadata(PostMetadataCreateRequest("대분류 글", categoryId = root.id))
        posts.setPublished(post.id, true)
        assertNull(publicPosts.detailMetadata(post.slug).series)
    }

    /**
     * 공개 분류와 부모의 표시 이름·순서 보존, 빈 분류 제외와 순서 변경 revision 검증
     */
    @Test
    fun snapshotIncludesOnlyPublicCategoryPathsAndTracksParentOrder() {
        val child = categories.create("Z First/Child Name")
        categories.create("Private Empty")
        val post = posts.createMetadata(PostMetadataCreateRequest("분류 스냅샷", categoryId = child.id))
        posts.setPublished(post.id, true)
        val snapshot = pages.snapshot()
        val visible = snapshot["categories"] as List<*>
        assertEquals(listOf("Z First", "Child Name"), visible.map { (it as Map<*, *>)["name"] })
        assertTrue(visible.all { (it as Map<*, *>).containsKey("sortOrder") })
        val parent = categories.tree().single { it.path == "z-first" }
        categories.setOrder(parent.id, 99)
        assertNotEquals(snapshot["revision"], pages.snapshot()["revision"])
    }
}
