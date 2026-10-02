package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest
import io.github.gjaku1031.kenblog.post.service.PostService
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
import java.time.ZoneOffset

/**
 * 본문을 저장하지 않는 글 메타데이터와 스키마 보존 계약을 격리 MySQL에서 검증
 */
@SpringBootTest
@Import(TestMysqlConfig::class)
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
) {
    /**
     * 테스트 간 영향을 막기 위해 글 초기화
     */
    @BeforeEach
    fun clearPosts() { jdbc.update("DELETE FROM posts") }

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
