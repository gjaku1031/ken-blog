package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import io.github.gjaku1031.kenblog.post.domain.DuplicatePostSlugException
import io.github.gjaku1031.kenblog.post.domain.InvalidPostDraftException
import io.github.gjaku1031.kenblog.post.service.PostService
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.time.ZoneOffset

/**
 * Flyway 스키마와 [PostService] 저장 계약을 격리된 실제 MySQL에서 검증.
 *
 * 각 테스트는 데이터 행만 지우며 스키마와 Flyway 이력은 유지하여 재마이그레이션 동작도 검증함.
 *
 * @property service 검증 대상 초안 서비스
 * @property jdbc DB 제약과 남은 행을 독립적으로 확인할 JDBC 도구
 * @property flyway 실제 마이그레이션 이력 확인 도구
 * @property transactionManager 여러 서비스 호출의 롤백을 확인할 트랜잭션 관리자
 */
@SpringBootTest
@Import(TestMysqlConfig::class)
class PostPersistenceIntegrationTest(
    @Autowired private val service: PostService,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val flyway: Flyway,
    @Autowired private val transactionManager: PlatformTransactionManager,
) {
    /** 각 테스트가 이전 테스트의 초안 행에 영향을 받지 않도록 데이터만 비움. */
    @BeforeEach
    fun clearPosts() {
        jdbc.update("DELETE FROM posts")
    }

    /** 제목·slug 정규화, UTC 시각, ID와 slug를 통한 새 트랜잭션 재조회를 검증. */
    @Test
    fun savesNormalizedDraftAndReloadsByIdAndSlug() {
        val beforeCreate = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        val created = service.createDraft("  첫 글  ", "  My-First-Post  ", "초안\n본문")
        val afterCreate = Instant.now()
        val id = created.id ?: error("저장 후 ID가 없음")

        val byId = service.findById(id) ?: error("ID로 재조회 실패")
        val bySlug = service.findBySlug(" MY-FIRST-POST ") ?: error("slug로 재조회 실패")
        assertEquals("첫 글", byId.title)
        assertEquals("my-first-post", byId.slug)
        assertEquals("초안\n본문", bySlug.body)
        assertEquals(id, bySlug.id)
        assertEquals(byId.createdAt, byId.updatedAt)
        val storedInstant = byId.createdAt.toInstant(ZoneOffset.UTC)
        assertFalse(storedInstant.isBefore(beforeCreate))
        assertFalse(storedInstant.isAfter(afterCreate))
        assertNull(service.findById(-1))
        assertNull(service.findBySlug("invalid slug"))
    }

    /** Unicode 코드 포인트 제목과 UTF-8 본문 최대 크기가 MySQL 왕복에도 유지되는지 검증. */
    @Test
    fun acceptsExactTitleAndBodyLimits() {
        val title = "😀".repeat(200)
        val body = "a".repeat(1024 * 1024)

        service.createDraft(title, "at-limit", body)

        val reloaded = service.findBySlug("at-limit") ?: error("최대 크기 초안 재조회 실패")
        assertEquals(title, reloaded.title)
        assertEquals(body, reloaded.body)
    }

    /** 공백 제목·slug, 잘못된 형식, 한도 초과 입력이 DB에 남지 않는지 검증. */
    @Test
    fun rejectsInvalidInputsBeforeWriting() {
        assertThrows<InvalidPostDraftException> { service.createDraft("   ", "valid", "") }
        assertThrows<InvalidPostDraftException> { service.createDraft("제목", "   ", "") }
        assertThrows<InvalidPostDraftException> { service.createDraft("제목", "bad--slug", "") }
        assertThrows<InvalidPostDraftException> { service.createDraft("제목", "a".repeat(161), "") }
        assertThrows<InvalidPostDraftException> { service.createDraft("가".repeat(201), "valid", "") }
        assertThrows<InvalidPostDraftException> { service.createDraft("제목", "valid", "가".repeat(349526)) }
        assertEquals(0, countPosts())
    }

    /** MySQL 고유 인덱스가 정규화된 slug 충돌을 막고 전용 예외를 반환하는지 검증. */
    @Test
    fun duplicateSlugFailsAtDatabaseConstraint() {
        service.createDraft("원본", "same-slug", "")

        assertThrows<DuplicatePostSlugException> {
            service.createDraft("다른 제목", " SAME-SLUG ", "")
        }
        assertEquals(1, countPosts())
        assertEquals("원본", service.findBySlug("same-slug")?.title)
    }

    /** 나중 쓰기 충돌이 같은 외부 트랜잭션의 첫 쓰기까지 되돌리는지 검증. */
    @Test
    fun rollsBackWholeTransactionAfterDuplicate() {
        service.createDraft("기존", "already-used", "")

        assertThrows<DuplicatePostSlugException> {
            TransactionTemplate(transactionManager).execute {
                service.createDraft("첫 저장", "must-rollback", "")
                service.createDraft("충돌", "already-used", "")
            }
        }
        assertNull(service.findBySlug("must-rollback"))
        assertEquals(1, countPosts())
    }

    /** Flyway V1~V7이 적용되고 동일 DB의 두 번째 migrate는 아무 변경도 하지 않는지 검증. */
    @Test
    fun migrationIsIdempotent() {
        val migrations = flyway.info().applied()
        assertEquals(listOf("1", "2", "3", "4", "5", "6", "7"), migrations.map { it.version.version })
        assertEquals(0, flyway.migrate().migrationsExecuted)
        assertTrue(jdbc.queryForObject(
            "SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'posts' AND constraint_name = 'uk_posts_slug'",
            Int::class.java,
        )!! > 0)
        assertTrue(jdbc.queryForObject(
            "SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'users' AND constraint_name = 'uk_users_username'",
            Int::class.java,
        )!! > 0)
        assertFalse(flyway.info().applied().isEmpty())
    }

    /**
     * 테스트 데이터가 남아 있는 행 수를 DB에서 직접 읽음.
     *
     * @return `posts`의 행 수
     */
    private fun countPosts(): Int = jdbc.queryForObject("SELECT COUNT(*) FROM posts", Int::class.java)!!
}
