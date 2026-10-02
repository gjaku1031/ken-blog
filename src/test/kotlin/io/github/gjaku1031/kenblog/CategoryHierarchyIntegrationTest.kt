package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException
import io.github.gjaku1031.kenblog.category.service.CategoryService
import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest
import io.github.gjaku1031.kenblog.post.service.PostService
import io.github.gjaku1031.kenblog.post.service.PublicPostService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.annotation.Transactional

/** 대분류·소분류 생성과 소분류 내 공개 문서 탐색의 MySQL 계약. */
@SpringBootTest
@Import(TestMysqlConfig::class)
@Transactional
class CategoryHierarchyIntegrationTest(
    @Autowired private val categories: CategoryService,
    @Autowired private val posts: PostService,
    @Autowired private val publicPosts: PublicPostService,
    @Autowired private val jdbc: JdbcTemplate,
) {
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

    @Test
    fun rejectsDeeperPathsBeforeCreatingAnyParent() {
        val before = jdbc.queryForObject("SELECT COUNT(*) FROM categories", Int::class.java)
        for (path in listOf("New/Child/Leaf", "New/Child/Leaf/Fourth")) {
            assertThrows<InvalidCategoryRequestException> { categories.create(path) }
        }
        assertEquals(before, jdbc.queryForObject("SELECT COUNT(*) FROM categories", Int::class.java))
    }

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

    @Test
    fun topLevelDoesNotCreateAnAutomaticReadingSeries() {
        val root = categories.create("Math")
        val post = posts.createMetadata(PostMetadataCreateRequest("대분류 글", categoryId = root.id))
        posts.setPublished(post.id, true)
        assertNull(publicPosts.detailMetadata(post.slug).series)
    }
}
