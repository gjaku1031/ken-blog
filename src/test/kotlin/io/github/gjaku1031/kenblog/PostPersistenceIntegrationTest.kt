package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest
import io.github.gjaku1031.kenblog.post.service.PostService
import jakarta.persistence.EntityManager
import org.hibernate.Hibernate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.core.io.ClassPathResource
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * 본문을 저장하지 않는 글 메타데이터와 스키마 보존 계약을 격리 MySQL에서 검증
 */
@SpringBootTest
@Import(TestMysqlConfig::class, io.github.gjaku1031.kenblog.fixture.SqlCountConfig::class)
class PostPersistenceIntegrationTest(
    /**
     * 게시글 서비스
     */
    @Autowired private val service: PostService,

    /**
     * JDBC 쿼리 실행기
     */
    @Autowired private val jdbc: JdbcTemplate,

    /**
     * 테스트 트랜잭션 관리자
     */
    @Autowired private val transactionManager: PlatformTransactionManager,

    /**
     * 현재 트랜잭션의 엔티티·프록시 조회기
     */
    @Autowired private val entityManager: EntityManager,

    /**
     * 분류 삭제의 실제 일괄 이동 검증
     */
    @Autowired private val categories: io.github.gjaku1031.kenblog.category.service.CategoryService,

    /**
     * 공개 스냅샷과 일괄 탐색 조립 검증
     */
    @Autowired private val snapshots: io.github.gjaku1031.kenblog.pages.PagesSnapshotService,

    /**
     * 스냅샷의 jOOQ 조회 실행 횟수
     */
    @Autowired private val selects: io.github.gjaku1031.kenblog.fixture.SelectCounter,


) {
    /**
     * 테스트 간 영향을 막기 위해 글 초기화
     */
    @BeforeEach
    fun clearPosts() { jdbc.update("DELETE FROM posts") }

    /**
     * 태그만 바뀌어도 이전 폼을 거부하고 잘못된 소속 변경은 모든 필드를 롤백
     */
    @Test
    fun atomicEditsRejectStaleVersionsAndRollback() {
        val created = service.createMetadata(PostMetadataCreateRequest("기준 글", "versioned-post"))
        val input = PostMetadataCreateRequest("기준 글", summary = "", tags = listOf("새 태그"))
        val edited = service.updateMetadata(created.id, input, created.editVersion)
        assertEquals(created.editVersion + 1, edited.editVersion)
        assertThrows<io.github.gjaku1031.kenblog.post.domain.PostEditConflictException> {
            service.updateMetadata(created.id, input.copy(title = "덮어쓰기"), created.editVersion)
        }
        assertThrows<InvalidPostRequestException> {
            service.updateMetadata(created.id, input.copy(title = "롤백할 제목", order = 3), edited.editVersion)
        }
        val reloaded = service.adminMetadata(created.id)
        assertEquals("기준 글", reloaded.title)
        assertEquals(listOf("새 태그"), reloaded.tags)
        assertEquals(edited.editVersion, reloaded.editVersion)
        assertEquals("", jdbc.queryForObject("SELECT body FROM posts WHERE id = ?", String::class.java, created.id))
    }

    /**
     * 같은 버전의 동시 저장 중 하나만 커밋하고 나머지는 편집 충돌
     */
    @Test
    fun concurrentEditorsHaveOneWinner() {
        val created = service.createMetadata(PostMetadataCreateRequest("동시 글", "concurrent-edit"))
        java.util.concurrent.Executors.newFixedThreadPool(2).use { pool ->
            val gate = java.util.concurrent.CountDownLatch(1)
            val results = (1..2).map { index -> pool.submit<Boolean> {
                gate.await()
                try { service.updateMetadata(created.id, PostMetadataCreateRequest("제목 $index"), created.editVersion); true }
                catch (_: io.github.gjaku1031.kenblog.post.domain.PostEditConflictException) { false }
            } }
            gate.countDown()
            assertEquals(1, results.count { it.get(15, java.util.concurrent.TimeUnit.SECONDS) })
        }
    }

    /**
     * 분류 삭제의 일괄 이동도 편집 버전을 올리고 원고·정렬 값 보존
     */
    @Test
    fun categoryMovesInvalidateEditors() {
        val category = categories.create("move-root-${java.util.UUID.randomUUID()}").id
        val created = service.createMetadata(PostMetadataCreateRequest("이동 글", "category-edit", categoryId = category, order = 3))
        categories.delete(category)
        assertEquals(created.editVersion + 1, service.adminMetadata(created.id).editVersion)
        assertEquals(3, service.adminMetadata(created.id).seriesOrder)
        assertThrows<io.github.gjaku1031.kenblog.post.domain.PostEditConflictException> {
            service.updateMetadata(created.id, PostMetadataCreateRequest("오래된 이동"), created.editVersion)
        }
    }

    /**
     * 300개 글의 공개 탐색 목록을 한 번만 직렬화하고 관리자 스냅샷의 읽기 시점 유지
     */
    @Test
    fun largeSnapshotsAreBoundedAndConsistent() {
        val category = categories.create("snapshot-${java.util.UUID.randomUUID()}/child").id
        val sql = "INSERT INTO posts (title, slug, body, body_sha256, summary, created_at, updated_at, status, visibility, section, view_count, edit_version, category_id, published_at) " +
            "VALUES (?, ?, '', REPEAT('0', 64), '', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'PUBLISHED', 'PUBLIC', 'TECH', 0, 0, ?, UTC_TIMESTAMP(6))"
        jdbc.batchUpdate(sql, (1..300).map { arrayOf<Any>("스냅샷 $it", "snapshot-$it", category) })
        val statistics = entityManager.entityManagerFactory.unwrap(org.hibernate.SessionFactory::class.java).statistics
        statistics.isStatisticsEnabled = true
        statistics.clear(); selects.count.set(0)
        val payload = snapshots.snapshot()
        assertTrue(statistics.prepareStatementCount + selects.count.get() <= 10)
        statistics.isStatisticsEnabled = false
        assertEquals(3, payload["version"])
        val navigation = payload["navigation"] as Map<*, *>
        assertEquals(1, navigation.size)
        assertEquals(300, (navigation.values.single() as List<*>).size)
        assertTrue(tools.jackson.databind.json.JsonMapper.builder().findAndAddModules().build().writeValueAsBytes(payload).size < 500_000)
        val transaction = TransactionTemplate(transactionManager).apply {
            isolationLevel = org.springframework.transaction.TransactionDefinition.ISOLATION_REPEATABLE_READ
        }
        java.util.concurrent.Executors.newSingleThreadExecutor().use { pool ->
            transaction.executeWithoutResult {
                val before = service.snapshot()
                assertEquals(300, before.size)
                val target = before.last()
                pool.submit { service.updateMetadata(target.id, PostMetadataCreateRequest("동시 변경", categoryId = category), target.editVersion) }
                    .get(15, java.util.concurrent.TimeUnit.SECONDS)
                assertEquals(before, service.snapshot())
            }
        }
        assertEquals(300, service.snapshot().map { it.id }.toSet().size)
        assertTrue(service.snapshot().any { it.title == "동시 변경" })
    }

    /**
     * 소속·관련 프로젝트를 반대로 지정한 동시 생성도 같은 부모 잠금 순서로 완료
     */
    @Test
    fun oppositeSeriesAssignmentsDoNotDeadlock() {
        val slugs = listOf("lock-a-${java.util.UUID.randomUUID()}", "lock-b-${java.util.UUID.randomUUID()}")
        for (slug in slugs) jdbc.update("INSERT INTO series (slug, name, description, kind, visibility, sort_order, created_at, updated_at) " +
            "VALUES (?, ?, '', 'PROJECT', 'PUBLIC', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", slug, slug)
        val ids = slugs.map { jdbc.queryForObject("SELECT id FROM series WHERE slug = ?", Long::class.java, it)!! }
        java.util.concurrent.Executors.newFixedThreadPool(2).use { pool ->
            repeat(3) {
                val gate = java.util.concurrent.CountDownLatch(1)
                val futures = (0..1).map { index -> pool.submit<io.github.gjaku1031.kenblog.post.dto.PostDetailResponse> {
                    gate.await()
                    service.createMetadata(PostMetadataCreateRequest("교차 소속", seriesId = ids[index], relatedSeriesId = ids[1 - index]))
                } }
                gate.countDown()
                futures.forEachIndexed { index, future ->
                    val result = future.get(15, java.util.concurrent.TimeUnit.SECONDS)
                    assertEquals(ids[index], result.series?.id)
                    assertEquals(ids[1 - index], result.relatedSeriesId)
                }
            }
        }
    }

    /**
     * 제목·slug 정규화와 DB 호환 원고 열의 빈 초기값을 검증
     */
    @Test
    fun savesMetadataAndReloadsByIdAndSlug() {
        val beforeCreate = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        val created = service.createMetadata(PostMetadataCreateRequest("  첫 글  ", "  FIRST-POST  "))
        val afterCreate = Instant.now()
        val id = created.id
        val byId = service.adminMetadata(id)
        assertEquals("첫 글", byId.title)
        assertEquals("first-post", byId.slug)
        assertEquals("", jdbc.queryForObject("SELECT body FROM posts WHERE slug = ?", String::class.java, "first-post"))
        assertEquals(PostVisibility.PUBLIC, byId.visibility)
        assertEquals(id, jdbc.queryForObject("SELECT id FROM posts WHERE slug = ?", Long::class.java, "first-post"))
        assertEquals(byId.createdAt, byId.updatedAt)
        val storedInstant = byId.createdAt.toInstant(ZoneOffset.UTC)
        assertFalse(storedInstant.isBefore(beforeCreate))
        assertFalse(storedInstant.isAfter(afterCreate))
    }

    /**
     * 지연 프록시의 프로퍼티 조회·도메인 변경과 DB 반영 검증
     *
     * 1. 기존 글의 프록시가 프로퍼티 조회 전까지 초기화되지 않음을 확인
     * 2. 새 프록시에서 도메인 메서드를 호출하여 초기화·변경 수행
     * 3. 커밋 뒤 제목·요약·수정 시각을 다시 조회
     */
    @Test
    fun loadsAndUpdatesMetadataThroughLazyProxy() {
        val created = service.createMetadata(PostMetadataCreateRequest("변경 전", "lazy-proxy"))
        val updatedAt = LocalDateTime.of(2026, 10, 3, 12, 0)

        TransactionTemplate(transactionManager).executeWithoutResult {
            // 프록시의 getter가 실제 행 조회와 초기화를 수행하는지 확인
            val reference = entityManager.getReference(PostEntity::class.java, created.id)
            assertFalse(Hibernate.isInitialized(reference))
            assertEquals("변경 전", reference.title)
            assertTrue(Hibernate.isInitialized(reference))

            // 이미 초기화된 인스턴스를 비우고 도메인 메서드의 프록시 호출 검증
            entityManager.clear()
            val freshReference = entityManager.getReference(PostEntity::class.java, created.id)
            assertFalse(Hibernate.isInitialized(freshReference))
            freshReference.replaceMetadata("변경 후", "프록시 변경", updatedAt)
            assertTrue(Hibernate.isInitialized(freshReference))
        }

        // 트랜잭션 밖에서 재조회하여 변경 감지와 커밋 결과 확인
        val reloaded = service.adminMetadata(created.id)
        assertEquals("변경 후", reloaded.title)
        assertEquals("프록시 변경", reloaded.summary)
        assertEquals(updatedAt, reloaded.updatedAt)
    }

    /**
     * Unicode 제목과 명시 요약의 최대 길이를 DB 왕복으로 확인
     */
    @Test
    fun acceptsExactMetadataLimits() {
        val title = "😀".repeat(200)
        val summary = "가".repeat(120)
        val created = service.createMetadata(PostMetadataCreateRequest(title, "limit-post", summary))
        val reloaded = service.adminMetadata(created.id)
        assertEquals(title, reloaded.title)
        assertEquals(summary, reloaded.summary)
        assertEquals("", jdbc.queryForObject("SELECT body FROM posts WHERE id = ?", String::class.java, created.id))
    }

    /**
     * 본문 입력이 없는 등록 경계에서 제목·slug·요약 오류를 거부
     */
    @Test
    fun rejectsInvalidInputsBeforeWriting() {
        assertThrows<InvalidPostRequestException> {
            service.createMetadata(PostMetadataCreateRequest("   ", "blank-title"))
        }
        assertThrows<InvalidPostRequestException> {
            service.createMetadata(PostMetadataCreateRequest("가".repeat(201), "long-title"))
        }
        assertThrows<InvalidPostRequestException> {
            service.createMetadata(PostMetadataCreateRequest("제목", "invalid slug"))
        }
        assertThrows<InvalidPostRequestException> {
            service.createMetadata(PostMetadataCreateRequest("제목", "long-summary", "가".repeat(121)))
        }
        assertEquals(0, countPosts())
    }

    /**
     * 같은 slug의 DB 고유 인덱스가 직접 SQL 변경도 거부
     */
    @Test
    fun duplicateSlugFailsAtDatabaseConstraint() {
        val first = service.createMetadata(PostMetadataCreateRequest("원본", "same-slug"))
        val second = service.createMetadata(PostMetadataCreateRequest("다른 제목", "other-slug"))
        assertThrows<DataIntegrityViolationException> {
            jdbc.update("UPDATE posts SET slug = ? WHERE id = ?", first.slug, second.id)
        }
        assertEquals(2, countPosts())
        assertEquals("원본", service.adminMetadata(first.id).title)
    }

    /**
     * 나중 검증 실패가 같은 외부 트랜잭션의 첫 등록까지 되돌림
     *
     * 1. 외부 트랜잭션과 별개로 보존할 기존 글 생성
     * 2. 같은 트랜잭션의 후속 입력 오류로 앞선 저장도 롤백
     * 3. 기존 글만 남는지 확인
     */
    @Test
    fun rollsBackWholeTransactionAfterValidationFailure() {
        // 외부 트랜잭션과 별개로 보존할 기존 글 생성
        service.createMetadata(PostMetadataCreateRequest("기존", "existing-post"))
        // 같은 트랜잭션의 후속 입력 오류로 앞선 저장도 롤백
        assertThrows<InvalidPostRequestException> {
            TransactionTemplate(transactionManager).execute {
                service.createMetadata(PostMetadataCreateRequest("첫 저장", "first-post"))
                service.createMetadata(PostMetadataCreateRequest("   ", "invalid-post"))
            }
        }
        // 기존 글만 남는지 확인
        assertEquals(1, countPosts())
    }

    /**
     * 새 스키마의 글 주소·계정 고유 제약 확인
     */
    @Test
    fun freshSchemaHasUniqueConstraints() {
        assertTrue(jdbc.queryForObject(
            "SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'posts' AND constraint_name = 'uk_posts_slug'",
            Int::class.java,
        )!! > 0)
        assertTrue(jdbc.queryForObject(
            "SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'users' AND constraint_name = 'uk_users_username'",
            Int::class.java,
        )!! > 0)
    }

    /**
     * 글 삭제 시 FK가 태그·위키 선언을 함께 정리
     *
     * 1. 태그·위키 연결을 가진 삭제 대상 글 준비
     * 2. 부모 글 삭제 후 두 연결 테이블의 FK 연쇄 삭제 확인
     */
    @Test
    fun deletingPostCascadesToItsMetadata() {
        // 태그·위키 연결을 가진 삭제 대상 글 준비
        val post = service.createMetadata(PostMetadataCreateRequest("삭제할 글", "delete-post"))
        val id = post.id
        jdbc.update("INSERT INTO post_tags (post_id, position, tag_name, display_name) VALUES (?, 0, 'kotlin', 'Kotlin')", id)
        jdbc.update("INSERT INTO post_wiki_links (post_id, position, target_title) VALUES (?, 0, '다른 글')", id)
        // 부모 글 삭제 후 두 연결 테이블의 FK 연쇄 삭제 확인
        jdbc.update("DELETE FROM posts WHERE id = ?", id)
        for (table in listOf("post_tags", "post_wiki_links"))
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM $table WHERE post_id = ?", Int::class.java, id))
    }

    /**
     * schema 재실행이 기존 글·로그인 실패 상태·분류 잠금 행을 보존
     *
     * 1. 보존할 글과 로그인 실패 상태 준비
     * 2. 초기화 SQL을 연속 실행
     * 3. 기존 글·실패 상태·단일 잠금 행 유지 확인
     */
    @Test
    fun repeatedInitializationPreservesExistingState() {
        // 보존할 글과 로그인 실패 상태 준비
        val post = service.createMetadata(PostMetadataCreateRequest("유지할 글", "keep-post"))
        jdbc.update("UPDATE admin_auth_state SET failure_count = 2 WHERE id = 1")
        val initializer = ResourceDatabasePopulator(ClassPathResource("schema.sql"))
        // 초기화 SQL을 연속 실행
        repeat(2) { initializer.execute(jdbc.dataSource!!) }
        // 기존 글·실패 상태·단일 잠금 행 유지 확인
        assertEquals("유지할 글", service.adminMetadata(post.id).title)
        assertEquals(2, jdbc.queryForObject("SELECT failure_count FROM admin_auth_state WHERE id = 1", Int::class.java))
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM content_state WHERE id = 1", Int::class.java))
    }

    /**
     * 저장된 게시글 수 조회
     */
    private fun countPosts(): Int = jdbc.queryForObject("SELECT COUNT(*) FROM posts", Int::class.java)!!
}
