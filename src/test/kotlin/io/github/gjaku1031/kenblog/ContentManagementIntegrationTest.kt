package io.github.gjaku1031.kenblog

import jakarta.persistence.EntityManager
import org.hibernate.Hibernate
import io.github.gjaku1031.kenblog.category.domain.CategoryEntity
import io.github.gjaku1031.kenblog.category.domain.CategoryConflictException
import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException
import io.github.gjaku1031.kenblog.category.dto.CategoryNameRequest
import io.github.gjaku1031.kenblog.category.dto.CategoryReorderRequest
import io.github.gjaku1031.kenblog.category.service.CategoryService
import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest
import io.github.gjaku1031.kenblog.post.service.PostService
import io.github.gjaku1031.kenblog.series.domain.SeriesInUseException
import io.github.gjaku1031.kenblog.series.domain.SeriesKind
import io.github.gjaku1031.kenblog.series.domain.ProjectStatus
import io.github.gjaku1031.kenblog.series.dto.SeriesCreateRequest
import io.github.gjaku1031.kenblog.series.dto.SeriesMetadataRequest
import io.github.gjaku1031.kenblog.series.service.SeriesService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.annotation.Transactional
import tools.jackson.databind.ObjectMapper

/**
 * 이름 수정·형제 일괄 정렬·연결 글 삭제 제약의 실제 MySQL 검증
 */
@SpringBootTest
@Import(TestMysqlConfig::class)
@Transactional
class ContentManagementIntegrationTest(
    /**
     * 분류 변경 서비스
     */
    @Autowired private val categories: CategoryService,

    /**
     * 글 생성·삭제 서비스
     */
    @Autowired private val posts: PostService,

    /**
     * 시리즈 생성·삭제 서비스
     */
    @Autowired private val series: SeriesService,

    /**
     * 저장 행·종속 연결 대조
     */
    @Autowired private val jdbc: JdbcTemplate,

    /**
     * 실제 JSON 입력 파서
     */
    @Autowired private val mapper: ObjectMapper,

    /**
     * 지연 프록시·변경 감지 검증
     */
    @Autowired private val entities: EntityManager,
) {
    /**
     * 초안 소속 글과 관련 글이 각각 삭제를 막고 모두 지운 뒤 프로젝트 삭제 가능
     */
    @Test
    fun requiresRemovalOfBothOwnedAndRelatedPostsIncludingDrafts() {
        val project = series.create(SeriesCreateRequest(kind = SeriesKind.PROJECT,
            metadata = SeriesMetadataRequest("프로젝트", projectStatus = ProjectStatus.PLAN, startPeriod = "2026.10")))
        val cover = posts.createMetadata(PostMetadataCreateRequest("소개", seriesId = project.id))
        val related = posts.createMetadata(PostMetadataCreateRequest("관련 초안", relatedSeriesId = project.id, tags = listOf("테스트"), wikiTargets = listOf("대상")))
        assertThrows<SeriesInUseException> { series.delete(project.id) }
        posts.delete(cover.id)
        assertThrows<SeriesInUseException> { series.delete(project.id) }
        assertEquals(project.id, posts.adminMetadata(related.id).relatedSeriesId)
        posts.delete(related.id)
        series.delete(project.id)
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM series WHERE id=?", Int::class.java, project.id))
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM post_tags WHERE post_id=?", Int::class.java, related.id))
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM post_wiki_links WHERE post_id=?", Int::class.java, related.id))
    }

    /**
     * 일반 시리즈도 글이 남아 있으면 삭제 거부, 마지막 글 삭제 후 제거 가능
     */
    @Test
    fun regularSeriesUsesTheSameDeletionConstraint() {
        val group = series.create(SeriesCreateRequest(kind = SeriesKind.TECH, metadata = SeriesMetadataRequest("시리즈")))
        val post = posts.createMetadata(PostMetadataCreateRequest("소속 글", seriesId = group.id))
        posts.setPublished(post.id, true)
        assertThrows<SeriesInUseException> { series.delete(group.id) }
        posts.delete(post.id)
        series.delete(group.id)
        assertFalse(series.list(true).any { it.id == group.id })
    }

    /**
     * 부모·자식 이름 수정 시 주소·글 분류 FK·글 본문을 보존함 검증
     */
    @Test
    fun renamingPreservesPathsAndPostAssignments() {
        val child = categories.create("Spring/Security")
        val parent = categories.tree().single { it.path == "spring" }
        val post = posts.createMetadata(PostMetadataCreateRequest("보안 글", categoryId = child.id))
        val renamed = categories.rename(parent.id, "  Backend  Notes  ")
        assertEquals("Backend Notes", renamed.name)
        assertEquals("spring", renamed.path)
        assertEquals("Authentication", categories.rename(child.id, "Authentication").name)
        assertEquals("spring/security", posts.adminMetadata(post.id).category?.path)
        assertEquals(child.id, posts.adminMetadata(post.id).category?.id)
        assertEquals("", jdbc.queryForObject("SELECT body FROM posts WHERE id=?", String::class.java, post.id))
    }

    /**
     * 초기화 전 프록시의 이름 변경 호출이 실제 행에 반영되고 경로를 보존함 검증
     */
    @Test
    fun renamesThroughAnUninitializedProxy() {
        // 영속성 컨텍스트를 비워 지연 프록시에서 도메인 메서드 호출
        val category = categories.create("Proxy")
        entities.clear()
        val reference = entities.getReference(CategoryEntity::class.java, category.id)
        assertFalse(Hibernate.isInitialized(reference))
        reference.rename("Changed")
        assertTrue(Hibernate.isInitialized(reference))
        // 변경 감지 저장 후 새 조회에서도 이름·경로 일치 확인
        entities.flush()
        entities.clear()
        val reloaded = entities.find(CategoryEntity::class.java, category.id)
        assertEquals("Changed", reloaded.name)
        assertEquals(category.path, reloaded.path)
    }

    /**
     * 잘못된 이름과 형제 표시명 중복을 생성·수정 양쪽에서 거부
     */
    @Test
    fun rejectsInvalidAndDuplicateDisplayNames() {
        val first = categories.create("First")
        val second = categories.create("Second")
        categories.rename(first.id, "Renamed")
        assertThrows<CategoryConflictException> { categories.rename(second.id, "renamed") }
        assertThrows<CategoryConflictException> { categories.create("Renamed") }
        for (name in listOf("", "A/B", "A\nB", "x".repeat(61))) {
            assertThrows<InvalidCategoryRequestException> { categories.rename(first.id, name) }
        }
    }

    /**
     * 형제 전체 순서 저장·루트 재정렬과 다른 부모·누락·중복 입력 거부 검증
     */
    @Test
    fun reordersOnlyTheCompleteSiblingSet() {
        val first = categories.create("Parent/First")
        val second = categories.create("Parent/Second")
        val other = categories.create("Other/Child")
        val roots = categories.tree()
        val parent = roots.single { it.path == "parent" }
        categories.reorder(parent.id, listOf(second.id, first.id))
        val children = categories.tree().single { it.id == parent.id }.children
        assertEquals(listOf(second.id, first.id), children.map { it.id })
        assertEquals(listOf(1, 2), children.map { it.sortOrder })
        assertThrows<CategoryConflictException> { categories.reorder(parent.id, listOf(first.id, other.id)) }
        assertThrows<CategoryConflictException> { categories.reorder(parent.id, listOf(first.id)) }
        assertThrows<InvalidCategoryRequestException> { categories.reorder(parent.id, listOf(first.id, first.id)) }
        assertEquals(children, categories.tree().single { it.id == parent.id }.children)
        categories.reorder(null, roots.reversed().map { it.id })
        assertEquals(roots.reversed().map { it.id }, categories.tree().map { it.id })
    }

    /**
     * 이름·순서 JSON에서 타입 강제 변환·필드 생략·알 수 없는 필드 거부 검증
     */
    @Test
    fun rejectsMalformedManagementInputs() {
        for (json in listOf("{}", "{\"name\":42}", "{\"name\":\"Name\",\"path\":\"other\"}")) {
            assertThrows<InvalidCategoryRequestException> { CategoryNameRequest.fromJson(mapper.readTree(json)) }
        }
        for (json in listOf("{\"ids\":[1]}", "{\"parentId\":null,\"ids\":[\"1\"]}", "{\"parentId\":true,\"ids\":[1]}", "{\"parentId\":null,\"ids\":[1],\"extra\":true}")) {
            assertThrows<InvalidCategoryRequestException> { CategoryReorderRequest.fromJson(mapper.readTree(json)) }
        }
        assertEquals(listOf(2L, 1L), CategoryReorderRequest.fromJson(mapper.readTree("{\"parentId\":null,\"ids\":[2,1]}")).ids)
    }
}
