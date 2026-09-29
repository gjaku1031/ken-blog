package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.account.service.AccountService
import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.annotation.Transactional

/**
 * 실제 MySQL에서 선택적 초기 관리자 생성과 재시작 시 권한 경계를 검증.
 *
 * 테스트 전용 해시만 사용하고 운영 비밀값은 읽지 않음.
 *
 * @property service 관리자 준비 서비스
 * @property jdbc 실제 저장 행 확인 도구
 */
@SpringBootTest
@Import(TestMysqlConfig::class)
class AccountBootstrapIntegrationTest(
    @Autowired private val service: AccountService,
    @Autowired private val jdbc: JdbcTemplate,
) {
    /** 시작 시 관리자 한 명만 저장하고 새 외부 해시를 받아도 저장 해시를 유지하는지 검증. */
    @Test
    fun bootstrapsOneAdminAndPreservesExistingHash() {
        val original = jdbc.queryForObject("SELECT password_hash FROM users WHERE username = ?", String::class.java, "testadmin")!!
        assertEquals(TEST_HASH, original)
        assertNotEquals("test-password", original)
        assertEquals("ADMIN", jdbc.queryForObject("SELECT role FROM users WHERE username = ?", String::class.java, "testadmin"))

        service.ensureInitialAdmin("testadmin", "{bcrypt}" + BCryptPasswordEncoder().encode("rotated-test-password"))

        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM users", Int::class.java))
        assertEquals(original, jdbc.queryForObject("SELECT password_hash FROM users WHERE username = ?", String::class.java, "testadmin"))
    }

    /** 동명 일반 사용자를 자동 승격하지 않고 불완전한 설정도 거부하는지 검증. */
    @Test
    @Transactional
    fun refusesToPromoteExistingUserOrAcceptPlaintext() {
        jdbc.update("DELETE FROM users WHERE username = ?", "testadmin")
        jdbc.update(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'USER', UTC_TIMESTAMP(6))",
            "testadmin", TEST_HASH,
        )

        assertThrows<IllegalStateException> { service.ensureInitialAdmin("testadmin", TEST_HASH) }
        assertEquals("USER", jdbc.queryForObject("SELECT role FROM users WHERE username = ?", String::class.java, "testadmin"))
        assertThrows<IllegalStateException> { service.ensureInitialAdmin("testadmin", "") }
        assertThrows<IllegalStateException> { service.ensureInitialAdmin("testadmin", "test-password") }
        assertTrue(TEST_HASH.startsWith("{bcrypt}"))
    }

    private companion object {
        val TEST_HASH = "{bcrypt}" + BCryptPasswordEncoder().encode("test-password")

        /** 테스트용 비밀번호 해시만 Spring 설정에 전달함. */
        @JvmStatic
        @DynamicPropertySource
        fun adminProperties(registry: DynamicPropertyRegistry) {
            registry.add("app.bootstrap.admin.username") { "testadmin" }
            registry.add("app.bootstrap.admin.password-hash") { TEST_HASH }
        }
    }
}
