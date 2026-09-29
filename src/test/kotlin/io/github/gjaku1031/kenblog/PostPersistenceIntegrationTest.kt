package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import io.github.gjaku1031.kenblog.post.domain.InvalidPostDraftException
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
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
import org.springframework.dao.DataIntegrityViolationException
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

    /** 제목 정규화·자동 주소·UTC 시각·ID/주소 재조회를 검증. */
    @Test
    fun savesNormalizedDraftAndReloadsByIdAndSlug() {
        val beforeCreate = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        val created = service.createDraft("  첫 글  ", "초안\n본문")
        val afterCreate = Instant.now()
        val id = created.id ?: error("저장 후 ID가 없음")

        val byId = service.findById(id) ?: error("ID로 재조회 실패")
        val bySlug = service.findBySlug(created.slug.uppercase()) ?: error("slug로 재조회 실패")
        assertEquals("첫 글", byId.title)
        assertTrue(Regex("post-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}").matches(byId.slug))
        assertEquals("초안\n본문", bySlug.body)
        assertEquals(PostVisibility.PUBLIC, bySlug.visibility)
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

        val created = service.createDraft(title, body)

        val reloaded = service.findBySlug(created.slug) ?: error("최대 크기 초안 재조회 실패")
        assertEquals(title, reloaded.title)
        assertEquals(body, reloaded.body)
    }

    /** 공백 제목과 길이 한도 초과 입력이 DB에 남지 않는지 검증. */
    @Test
    fun rejectsInvalidInputsBeforeWriting() {
        assertThrows<InvalidPostDraftException> { service.createDraft("   ", "") }
        assertThrows<InvalidPostDraftException> { service.createDraft("가".repeat(201), "") }
        assertThrows<InvalidPostDraftException> { service.createDraft("제목", "가".repeat(349526)) }
        assertEquals(0, countPosts())
    }

    /** 서로 다른 자동 주소와 DB 고유 인덱스의 충돌 차단을 검증. */
    @Test
    fun duplicateSlugFailsAtDatabaseConstraint() {
        val first = service.createDraft("원본", "")
        val second = service.createDraft("다른 제목", "")
        assertTrue(first.slug != second.slug)
        assertThrows<DataIntegrityViolationException> {
            jdbc.update("UPDATE posts SET slug = ? WHERE id = ?", first.slug, second.id)
        }
        assertEquals(2, countPosts())
        assertEquals("원본", service.findBySlug(first.slug)?.title)
    }

    /** 나중 쓰기 검증 실패가 같은 외부 트랜잭션의 첫 쓰기까지 되돌리는지 검증. */
    @Test
    fun rollsBackWholeTransactionAfterValidationFailure() {
        service.createDraft("기존", "")

        assertThrows<InvalidPostDraftException> {
            TransactionTemplate(transactionManager).execute {
                service.createDraft("첫 저장", "")
                service.createDraft("   ", "")
            }
        }
        assertEquals(1, countPosts())
    }

    /** 기존 Flyway 이력과 V25 이후 이력이 연속 적용되고 재실행은 멱등인지 검증. */
    @Test
    fun migrationIsIdempotent() {
        val migrations = flyway.info().applied()
        assertTrue(migrations.size >= 25)
        assertEquals((1..migrations.size).map(Int::toString), migrations.map { it.version.version })
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
