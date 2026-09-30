package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftCreateRequest
import io.github.gjaku1031.kenblog.draft.service.EditorDraftService
import io.github.gjaku1031.kenblog.post.domain.InvalidPostDraftException
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.service.PostService
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
import org.springframework.core.io.ClassPathResource
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.time.ZoneOffset

/**
 * 새 DB 스키마와 [PostService] 저장 계약을 격리된 실제 MySQL에서 검증.
 *
 * 각 테스트는 데이터 행만 지우며 JPA가 생성한 스키마의 제약도 검증함.
 *
 * @property service 검증 대상 초안 서비스
 * @property jdbc DB 제약과 남은 행을 독립적으로 확인할 JDBC 도구
 * @property transactionManager 여러 서비스 호출의 롤백을 확인할 트랜잭션 관리자
 */
@SpringBootTest
@Import(TestMysqlConfig::class)
class PostPersistenceIntegrationTest(
    @Autowired private val service: PostService,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val drafts: EditorDraftService,
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

    /** 새 DB에서도 주소·계정의 고유 제약이 생성되는지 검증. */
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

    /** 새 스키마의 FK가 글 삭제 시 태그·위키·편집본까지 제거하는지 검증. */
    @Test
    fun deletingPostCascadesToItsMetadataAndDraft() {
        val post = service.createDraft("삭제할 글", "본문")
        val id = post.id!!
        jdbc.update("INSERT INTO post_tags (post_id, position, tag_name, display_name) VALUES (?, 0, 'kotlin', 'Kotlin')", id)
        jdbc.update("INSERT INTO post_wiki_links (post_id, position, target_title) VALUES (?, 0, '다른 글')", id)
        val draft = drafts.create(EditorDraftCreateRequest(
            postId = id, baseUpdatedAt = post.updatedAt, title = post.title, body = post.body,
            categoryId = null, tags = emptyList(), visibility = PostVisibility.PUBLIC,
            attachmentIds = emptyList(), wikiTargets = listOf("다른 글"),
        ))

        service.deleteDraft(id)

        for (table in listOf("post_tags", "post_wiki_links", "editor_drafts")) {
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM $table WHERE post_id = ?", Int::class.java, id))
        }
        assertEquals(0, jdbc.queryForObject(
            "SELECT COUNT(*) FROM editor_draft_wiki_links WHERE editor_draft_id = ?", Int::class.java, draft.id,
        ))
        assertThrows<DataIntegrityViolationException> {
            jdbc.update("INSERT INTO post_tags (post_id, position, tag_name, display_name) VALUES (?, 0, 'kotlin', 'Kotlin')", id)
        }
    }

    /** 재시작 초기화가 게시글과 소비된 복구 코드, 배포 버전을 초기값으로 덮지 않는지 검증. */
    @Test
    fun repeatedInitializationPreservesExistingState() {
        val post = service.createDraft("유지할 글", "본문")
        val codeHash = "c".repeat(64)
        val version = jdbc.queryForObject("SELECT version FROM deployment_state WHERE singleton_id = 1", Long::class.java)!!
        try {
            jdbc.update("INSERT INTO admin_recovery_codes (code_hash, consumed_at) VALUES (?, UTC_TIMESTAMP(6))", codeHash)
            jdbc.update("UPDATE deployment_state SET version = ? WHERE singleton_id = 1", version + 1)

            val initializer = ResourceDatabasePopulator(ClassPathResource("schema.sql"))
            repeat(2) { initializer.execute(jdbc.dataSource!!) }

            assertEquals("유지할 글", service.findById(post.id!!)?.title)
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM admin_recovery_codes WHERE code_hash = ? AND consumed_at IS NOT NULL", Int::class.java, codeHash))
            assertEquals(version + 1, jdbc.queryForObject("SELECT version FROM deployment_state WHERE singleton_id = 1", Long::class.java))
        } finally {
            jdbc.update("DELETE FROM admin_recovery_codes WHERE code_hash = ?", codeHash)
            jdbc.update("UPDATE deployment_state SET version = ? WHERE singleton_id = 1", version)
        }
    }

    /**
     * 테스트 데이터가 남아 있는 행 수를 DB에서 직접 읽음.
     *
     * @return `posts`의 행 수
     */
    private fun countPosts(): Int = jdbc.queryForObject("SELECT COUNT(*) FROM posts", Int::class.java)!!
}
