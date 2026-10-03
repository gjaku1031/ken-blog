package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.auth.service.AdminLoginAttemptService
import io.github.gjaku1031.kenblog.fixture.TestAdminProbeController
import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.TestMethodOrder
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.assertThrows
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import org.springframework.dao.EmptyResultDataAccessException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.session.SessionRepository
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import tools.jackson.databind.ObjectMapper
import java.net.CookieManager
import java.net.CookiePolicy
import java.net.HttpCookie
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.Base64

/**
 * 실제 서버·MySQL에서 브라우저 쿠키, CSRF, 로그인과 역할 경계를 검증
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["server.servlet.session.cookie.secure=false", "app.auth.cors.allowed-origins=http://127.0.0.1:14000",
        "app.cors.allowed-origins=https://gjaku1031.github.io"],
)
@Import(TestMysqlConfig::class, TestAdminProbeController::class)
@TestMethodOrder(OrderAnnotation::class)
class AuthHttpIntegrationTest {
    /**
     * 테스트 서버 포트
     */
    @LocalServerPort
    private var port: Int = 0

    /**
     * JSON 직렬화기
     */
    @Autowired
    private lateinit var mapper: ObjectMapper

    /**
     * JDBC 쿼리 실행기
     */
    @Autowired
    private lateinit var jdbc: JdbcTemplate

    /**
     * 필수 인증 상태가 없을 때의 로그인 실패 계약 검사
     */
    @Autowired
    private lateinit var attempts: AdminLoginAttemptService

    /**
     * 테스트 세션 저장소
     */
    @Autowired
    private lateinit var sessions: SessionRepository<*>

    /**
     * 운영 자동 생성에 의존하지 않고 격리 테스트 DB에만 관리자 행 준비
     */
    @BeforeEach
    fun prepareAdmin() {
        jdbc.update(
            "INSERT IGNORE INTO users (username, password_hash, role, created_at, enabled) VALUES (?, ?, 'ADMIN', UTC_TIMESTAMP(6), true)",
            "testadmin", TEST_HASH,
        )
        jdbc.update("UPDATE users SET password_hash = ?, role = 'ADMIN', enabled = true WHERE username = 'testadmin'", TEST_HASH)
        jdbc.update("UPDATE admin_auth_state SET failure_count = 0, locked_until = NULL WHERE id = 1")
        jdbc.update("DELETE FROM admin_login_sources")
    }

    /**
     * 공개 HEAD·CORS는 GET과 같은 권한을 사용하고 관리자 HEAD는 인증 필요
     */
    @Test
    fun publicHeadBoundaries() {
        val client = newClient().first
        for (path in listOf("/actuator/health", "/api/v1/pages/snapshot")) {
            val response = send(client, "HEAD", path)
            assertEquals(200, response.statusCode())
            assertEquals("", response.body())
        }
        for (path in listOf("/api/v1/posts/999999/attachments/999999/content", "/api/v1/stack-badges/999999/image")) {
            assertEquals(404, send(client, "HEAD", path, headers = mapOf("Accept" to "image/png")).statusCode())
            assertEquals(200, send(client, "OPTIONS", path, headers = mapOf("Origin" to "https://gjaku1031.github.io",
                "Access-Control-Request-Method" to "HEAD")).statusCode())
        }
        assertEquals(401, send(client, "HEAD", "/api/v1/admin/posts/snapshot").statusCode())
    }

    /**
     * 계정 비활성화·권한 강등·비밀번호 변경 직후 기존 세션 거부
     */
    @Test
    fun accountChangesInvalidateExistingSessions() {
        for (change in listOf("enabled = false", "role = 'USER'", "password_hash = CONCAT(password_hash, 'changed')")) {
            prepareAdmin()
            val client = newClient().first
            assertEquals(200, send(client, "POST", "/api/v1/auth/login", body = loginBody(TEST_PASSWORD, "missing"), csrf = csrfToken(client)).statusCode())
            jdbc.update("UPDATE users SET $change WHERE username = 'testadmin'")
            assertEquals(401, send(client, "GET", "/api/v1/auth/me").statusCode())
        }
    }

    /**
     * 기억 로그인은 JDBC 30일 비활동 한도와 같은 쿠키 수명 사용, 로그아웃 시 영속 행 폐기
     */
    @Test
    fun rememberedSessionUsesThirtyDayDatabaseExpiry() {
        val (client, cookies) = newClient()
        val response = send(client, "POST", "/api/v1/auth/login", csrf = csrfToken(client),
            body = mapper.writeValueAsString(mapOf("password" to TEST_PASSWORD, "rememberMe" to true)))
        assertEquals(200, response.statusCode())
        assertTrue(response.headers().allValues("Set-Cookie").any { it.contains("Max-Age=2592000") })
        val id = decodeSessionId(sessionCookie(cookies))
        assertEquals(Duration.ofDays(30), sessions.findById(id)?.maxInactiveInterval)
        assertEquals(204, send(client, "POST", "/api/v1/auth/logout", csrf = csrfToken(client)).statusCode())
        assertEquals(0, sessionCount(id))
    }

    /**
     * 한 출처의 실패·잠금은 다른 출처를 잠그지 않고 만료 시 다시 검증 가능
     */
    @Test
    fun sourceLimitsExpireWithoutLockingOtherClients() {
        repeat(4) { assertEquals(io.github.gjaku1031.kenblog.auth.service.AdminLoginResult.Denied, attempts.attempt("wrong", "source-a")) }
        assertEquals(io.github.gjaku1031.kenblog.auth.service.AdminLoginResult.Locked, attempts.attempt("wrong", "source-a"))
        assertEquals(io.github.gjaku1031.kenblog.auth.service.AdminLoginResult.Locked, attempts.attempt(TEST_PASSWORD, "source-a"))
        assertTrue(attempts.attempt(TEST_PASSWORD, "source-b") is io.github.gjaku1031.kenblog.auth.service.AdminLoginResult.Success)
        jdbc.update("UPDATE admin_login_sources SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE source_key = 'source-a'")
        assertTrue(attempts.attempt(TEST_PASSWORD, "source-a") is io.github.gjaku1031.kenblog.auth.service.AdminLoginResult.Success)
    }

    /**
     * 동시에 시작한 실패도 DB 잠금으로 직렬화하고 전체 연산 한도 유지
     */
    @Test
    fun parallelAttemptsCannotBypassFailureLimits() {
        java.util.concurrent.Executors.newFixedThreadPool(6).use { pool ->
            val gate = java.util.concurrent.CountDownLatch(1)
            val futures = (1..6).map { pool.submit<io.github.gjaku1031.kenblog.auth.service.AdminLoginResult> { gate.await(); attempts.attempt("wrong", "parallel") } }
            gate.countDown()
            val results = futures.map { it.get(15, java.util.concurrent.TimeUnit.SECONDS) }
            assertEquals(4, results.count { it is io.github.gjaku1031.kenblog.auth.service.AdminLoginResult.Denied })
            assertEquals(2, results.count { it is io.github.gjaku1031.kenblog.auth.service.AdminLoginResult.Locked })
        }
        jdbc.update("UPDATE admin_auth_state SET failure_count = 30, locked_until = UTC_TIMESTAMP(6) + INTERVAL 60 SECOND WHERE id = 1")
        assertEquals(io.github.gjaku1031.kenblog.auth.service.AdminLoginResult.Locked, attempts.attempt(TEST_PASSWORD, "another-source"))
    }

    /**
     * 분류 순서 입력은 문자열·소수·범위 초과·알 수 없는 키를 강제 변환하지 않음
     */
    @Test
    fun categoryOrderRejectsCoercion() {
        val client = newClient().first
        assertEquals(200, send(client, "POST", "/api/v1/auth/login", body = loginBody(TEST_PASSWORD, "missing"), csrf = csrfToken(client)).statusCode())
        val token = csrfToken(client)
        val category = send(client, "POST", "/api/v1/admin/categories", csrf = token, body = """{"path":"order-${java.util.UUID.randomUUID()}"}""")
        assertEquals(201, category.statusCode())
        val id = mapper.readTree(category.body()).path("id").longValue()
        for (body in listOf("""{"order":"3"}""", """{"order":1.5}""", """{"order":9223372036854775808}""", """{"order":1,"extra":true}"""))
            assertEquals(400, send(client, "PUT", "/api/v1/admin/categories/$id/order", csrf = token, body = body).statusCode())
        assertEquals(200, send(client, "PUT", "/api/v1/admin/categories/$id/order", csrf = token, body = """{"order":-3}""").statusCode())
    }

    /**
     * 일반 스키마 재실행과 기동 검사에서 누락된 인증 상태를 복구하지 않음
     */
    @Test
    fun restartNeverRecreatesMissingAuthState() {
        val state = jdbc.queryForMap("SELECT * FROM admin_auth_state WHERE id = 1")
        jdbc.update("DELETE FROM admin_auth_state WHERE id = 1")
        try {
            org.springframework.jdbc.datasource.init.ResourceDatabasePopulator(org.springframework.core.io.ClassPathResource("schema.sql"))
                .execute(requireNotNull(jdbc.dataSource))
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM admin_auth_state", Int::class.java))
            assertThrows<EmptyResultDataAccessException> { attempts.run(org.springframework.boot.DefaultApplicationArguments()) }
        } finally {
            jdbc.update("INSERT INTO admin_auth_state (id, config_fingerprint, auth_version, failure_count, locked_until) VALUES (1, ?, ?, ?, ?)",
                state["config_fingerprint"], state["auth_version"], state["failure_count"], state["locked_until"])
        }
    }

    /**
     * 설정이 다른 관리자였다가 돌아와도 기존 세션 버전은 되살아나지 않음
     */
    @Test
    fun settingsRoundTripDoesNotReviveOldSession() {
        val client = newClient().first
        assertEquals(200, send(client, "POST", "/api/v1/auth/login", body = loginBody(TEST_PASSWORD, "missing"), csrf = csrfToken(client)).statusCode())
        val before = jdbc.queryForObject("SELECT auth_version FROM admin_auth_state WHERE id = 1", Long::class.java)!!
        // 다른 설정으로 운영되던 DB 상태를 명시적으로 만들고 현재 설정의 실제 기동 동기화 수행
        val other = io.github.gjaku1031.kenblog.auth.service.AdminAuthSettings("anotheradmin").configured()!!
        jdbc.update("UPDATE admin_auth_state SET config_fingerprint = ?, auth_version = auth_version + 1 WHERE id = 1", other.fingerprint)
        attempts.run(org.springframework.boot.DefaultApplicationArguments())
        assertEquals(before + 2, jdbc.queryForObject("SELECT auth_version FROM admin_auth_state WHERE id = 1", Long::class.java))
        assertEquals(401, send(client, "GET", "/api/v1/auth/me").statusCode())
    }

    /**
     * 명시적 인증 복구는 삭제 전 세션까지 전부 폐기하고 재로그인만 허용
     */
    @Test
    fun explicitRecoveryInvalidatesAllSessions() {
        val client = newClient().first
        assertEquals(200, send(client, "POST", "/api/v1/auth/login", body = loginBody(TEST_PASSWORD, "missing"), csrf = csrfToken(client)).statusCode())
        jdbc.update("DELETE FROM admin_auth_state WHERE id = 1")
        org.springframework.jdbc.datasource.init.ResourceDatabasePopulator(org.springframework.core.io.ClassPathResource("recover-auth-state.sql"))
            .execute(requireNotNull(jdbc.dataSource))
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM SPRING_SESSION", Int::class.java))
        attempts.run(org.springframework.boot.DefaultApplicationArguments())
        assertEquals(401, send(client, "GET", "/api/v1/auth/me").statusCode())
        assertEquals(200, send(client, "POST", "/api/v1/auth/login", body = loginBody(TEST_PASSWORD, "missing"), csrf = csrfToken(client)).statusCode())
    }

    /**
     * 실제 HTTP 편집은 기준 버전 필수이며 전체 저장·순서 변경 뒤 오래된 요청 거부
     */
    @Test
    fun metadataHttpContractRequiresVersionAndAtomicFields() {
        val client = newClient().first
        assertEquals(200, send(client, "POST", "/api/v1/auth/login", body = loginBody(TEST_PASSWORD, "missing"), csrf = csrfToken(client)).statusCode())
        val token = csrfToken(client)
        val created = send(client, "POST", "/api/v1/admin/posts", csrf = token, body = """{"title":"HTTP 편집"}""")
        assertEquals(201, created.statusCode())
        val row = mapper.readTree(created.body())
        val path = "/api/v1/admin/posts/${row.path("id").longValue()}"
        val payload = linkedMapOf<String, Any?>("baseVersion" to row.path("editVersion").longValue(), "title" to "원자적 변경",
            "summary" to "요약", "categoryId" to null, "tags" to listOf("HTTP"), "seriesId" to null, "order" to null, "relatedSeriesId" to null)
        val saved = send(client, "PATCH", "$path/metadata", csrf = token, body = mapper.writeValueAsString(payload))
        assertEquals(200, saved.statusCode())
        assertEquals(409, send(client, "PATCH", "$path/metadata", csrf = token, body = mapper.writeValueAsString(payload)).statusCode())
        for (invalid in listOf(payload - "baseVersion", payload + ("unexpected" to true)))
            assertEquals(400, send(client, "PATCH", "$path/metadata", csrf = token, body = mapper.writeValueAsString(invalid)).statusCode())
        assertEquals(400, send(client, "PUT", "$path/order", csrf = token, body = """{"order":null}""").statusCode())
        val version = mapper.readTree(saved.body()).path("editVersion").longValue()
        val ordered = send(client, "PUT", "$path/order", csrf = token, body = """{"order":null,"baseVersion":$version}""")
        assertEquals(200, ordered.statusCode())
        payload["baseVersion"] = version
        assertEquals(409, send(client, "PATCH", "$path/metadata", csrf = token, body = mapper.writeValueAsString(payload)).statusCode())
        val fresh = mapper.readTree(send(client, "GET", path).body())
        assertEquals("원자적 변경", fresh.path("title").stringValue())
        assertEquals(version + 1, fresh.path("editVersion").longValue())
    }

    /**
     * 익명 경로와 인증 경로의 CORS·쿠키 정책 및 ProblemDetail을 실제 HTTP로 검증
     *
     * 1. 독립 브라우저로 공개 읽기와 익명 접근 거부 검증
     * 2. 허용 origin·거부 origin의 인증 사전 요청 비교
     * 3. 로컬 HTTP용 세션 쿠키 속성 검증
     */
    @Test
    @Order(1)
    fun publicAndAnonymousBoundaries() {
        // 독립 브라우저로 공개 읽기와 익명 접근 거부 검증
        val client = newClient().first
        val snapshot = send(client, "GET", "/api/v1/pages/snapshot", headers = mapOf("Origin" to "https://gjaku1031.github.io"))
        assertEquals(200, snapshot.statusCode())
        assertEquals("https://gjaku1031.github.io", snapshot.headers().firstValue("Access-Control-Allow-Origin").orElse(null))
        assertFalse(snapshot.headers().firstValue("Access-Control-Allow-Credentials").isPresent)
        assertEquals(401, send(client, "GET", "/api/v1/auth/me").statusCode())
        assertEquals(401, send(client, "GET", "/api/v1/admin/__test").statusCode())

        // 허용 origin·거부 origin의 인증 사전 요청 비교
        val preflight = send(client, "OPTIONS", "/api/v1/auth/login", headers = mapOf(
            "Origin" to "http://127.0.0.1:14000",
            "Access-Control-Request-Method" to "POST",
            "Access-Control-Request-Headers" to "Content-Type,X-CSRF-TOKEN",
        ))
        assertEquals(200, preflight.statusCode())
        assertEquals("true", preflight.headers().firstValue("Access-Control-Allow-Credentials").orElse(null))
        val rejected = send(client, "OPTIONS", "/api/v1/auth/login", headers = mapOf(
            "Origin" to "https://gjaku1031.github.io",
            "Access-Control-Request-Method" to "POST",
        ))
        assertEquals(403, rejected.statusCode())
        assertFalse(rejected.headers().firstValue("Access-Control-Allow-Credentials").isPresent)

        // 로컬 HTTP용 세션 쿠키 속성 검증
        val csrf = send(client, "GET", "/api/v1/auth/csrf")
        assertEquals(200, csrf.statusCode())
        assertTrue(csrf.headers().allValues("set-cookie").any { it.contains("HttpOnly") && it.contains("SameSite=Lax") })
        assertFalse(csrf.headers().allValues("set-cookie").any { it.contains("Secure") })


    }

    /**
     * 로그인 CSRF, 세션 ID 교체, 로그아웃 후 이전 쿠키와 토큰의 무효화를 검증
     *
     * 1. 로그인 전 쿠키·CSRF 토큰 확보
     * 2. 정상 로그인 후 세션 ID 교체와 이전 토큰 무효화 검증
     * 3. 세션 직렬화 데이터에 비밀번호 해시가 없는지 확인
     * 4. 새 CSRF로 로그아웃 후 DB 세션·쿠키 재사용 거부 검증
     */
    @Test
    @Order(2)
    fun loginFixationAndLogout() {
        // 로그인 전 쿠키·CSRF 토큰 확보
        val (client, cookies) = newClient()
        val token = csrfToken(client)
        val before = sessionCookie(cookies)
        val body = loginBody(TEST_PASSWORD, "missing")

        assertProblem(send(client, "POST", "/api/v1/auth/login", body = body), 403)
        assertProblem(send(client, "POST", "/api/v1/auth/login", body = body, csrf = "wrong-token"), 403)

        // 정상 로그인 후 세션 ID 교체와 이전 토큰 무효화 검증
        val login = send(client, "POST", "/api/v1/auth/login", body = body, csrf = token)
        assertEquals(200, login.statusCode())
        assertEquals("ADMIN", mapper.readTree(login.body()).path("role").asString())
        val after = sessionCookie(cookies)
        assertNotEquals(before, after)
        assertEquals(200, send(client, "GET", "/api/v1/auth/me").statusCode())
        assertProblem(send(newClient().first, "GET", "/api/v1/auth/me", headers = mapOf("Cookie" to "KENBLOGSESSION=$before")), 401)
        assertProblem(send(client, "POST", "/api/v1/auth/logout", csrf = token), 403)

        val sessionId = decodeSessionId(after)
        assertEquals(1, sessionCount(sessionId))
        assertEquals(Duration.ofHours(8), sessions.findById(sessionId)?.maxInactiveInterval)
        // 세션 직렬화 데이터에 비밀번호 해시가 없는지 확인
        val serialized = jdbc.query(
            "SELECT a.ATTRIBUTE_BYTES FROM SPRING_SESSION_ATTRIBUTES a JOIN SPRING_SESSION s ON a.SESSION_PRIMARY_ID = s.PRIMARY_ID WHERE s.SESSION_ID = ?",
            { rs, _ -> rs.getBytes(1) }, sessionId,
        )
        assertTrue(serialized.none { String(it, Charsets.ISO_8859_1).contains(TEST_HASH) })

        // 새 CSRF로 로그아웃 후 DB 세션·쿠키 재사용 거부 검증
        val freshToken = csrfToken(client)
        assertEquals(204, send(client, "POST", "/api/v1/auth/logout", csrf = freshToken).statusCode())
        assertEquals(0, sessionCount(sessionId))
        assertProblem(send(newClient().first, "GET", "/api/v1/auth/me", headers = mapOf("Cookie" to "KENBLOGSESSION=$after")), 401)
    }

    /**
     * 빈 비밀번호, 잘못된 비밀번호, BCrypt 바이트 초과 입력이 같은 401 설명인지 검증
     *
     * 1. 오입력·빈 입력·BCrypt 길이 초과 요청 생성
     * 2. 상태와 공개 오류 설명이 같은지 비교
     */
    @Test
    @Order(3)
    fun badCredentialsAreIndistinguishable() {
        val (client, _) = newClient()
        val token = csrfToken(client)
        // 오입력·빈 입력·BCrypt 길이 초과 요청 생성
        val wrong = send(client, "POST", "/api/v1/auth/login", csrf = token, body = loginBody("wrong"))
        val missing = send(client, "POST", "/api/v1/auth/login", csrf = token,
            body = mapper.writeValueAsString(mapOf("password" to "")))
        val tooLong = send(client, "POST", "/api/v1/auth/login", csrf = token, body = loginBody("가".repeat(25)))
        // 상태와 공개 오류 설명이 같은지 비교
        listOf(wrong, missing, tooLong).forEach { assertProblem(it, 401) }
        assertEquals(mapper.readTree(wrong.body()).path("detail").asString(), mapper.readTree(missing.body()).path("detail").asString())
        assertEquals(mapper.readTree(wrong.body()).path("detail").asString(), mapper.readTree(tooLong.body()).path("detail").asString())
    }

    /**
     * 구 요청의 USER 이름은 무시하고 설정된 ADMIN만 세션 주체가 되는지 검증
     *
     * 1. 별도 USER 계정으로 구 요청의 사용자명 무시 조건 재현
     * 2. 세션 주체가 설정된 ADMIN인지 검증
     * 3. 실패 시에도 임시 USER 계정 정리
     */
    @Test
    @Order(4)
    fun userRoleCannotEnterAdminBoundary() {
        // 별도 USER 계정으로 구 요청의 사용자명 무시 조건 재현
        jdbc.update("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'USER', UTC_TIMESTAMP(6))", "testuser", TEST_HASH)
        try {
            val (client, _) = newClient()
            val token = csrfToken(client)
            assertEquals(200, send(client, "POST", "/api/v1/auth/login", csrf = token,
                body = loginBody(TEST_PASSWORD, "testuser")).statusCode())
            // 세션 주체가 설정된 ADMIN인지 검증
            val principal = mapper.readTree(send(client, "GET", "/api/v1/auth/me").body())
            assertEquals("testadmin", principal.path("username").asString())
            assertEquals("ADMIN", principal.path("role").asString())
            assertEquals(200, send(client, "GET", "/api/v1/admin/__test").statusCode())
        } finally {
            // 실패 시에도 임시 USER 계정 정리
            jdbc.update("DELETE FROM users WHERE username = ?", "testuser")
        }
    }

    /**
     * JDBC 세션 만료 시 브라우저 쿠키만으로 인증이 복원되지 않는지 검증
     *
     * 1. 로그인으로 유효한 세션·쿠키 생성
     * 2. DB 세션을 강제 만료한 뒤 쿠키 재사용 거부 확인
     */
    @Test
    @Order(5)
    fun expiredSessionCannotBeReused() {
        // 로그인으로 유효한 세션·쿠키 생성
        val (client, cookies) = newClient()
        val token = csrfToken(client)
        assertEquals(200, send(client, "POST", "/api/v1/auth/login", csrf = token, body = loginBody(TEST_PASSWORD)).statusCode())
        val sessionId = decodeSessionId(sessionCookie(cookies))
        assertEquals(1, sessionCount(sessionId))
        // DB 세션을 강제 만료한 뒤 쿠키 재사용 거부 확인
        jdbc.update("UPDATE SPRING_SESSION SET LAST_ACCESS_TIME = 0, EXPIRY_TIME = 0 WHERE SESSION_ID = ?", sessionId)
        assertProblem(send(client, "GET", "/api/v1/auth/me"), 401)
    }

    /**
     * 인증·CSRF를 확인하고 소속 초안이 없는 시리즈만 삭제 가능
     */
    @Test
    @Order(6)
    fun seriesDeletionRequiresRemovingItsPosts() {
        val client = newClient().first
        assertEquals(200, send(client, "POST", "/api/v1/auth/login", csrf = csrfToken(client), body = loginBody(TEST_PASSWORD)).statusCode())
        val token = csrfToken(client)
        val created = send(client, "POST", "/api/v1/admin/series", csrf = token,
            body = """{"kind":"TECH","metadata":{"name":"삭제 제약 시리즈"}}""")
        assertEquals(200, created.statusCode())
        val id = mapper.readTree(created.body()).path("id").asLong()
        val post = send(client, "POST", "/api/v1/admin/posts", csrf = token,
            body = """{"title":"소속 초안","seriesId":$id}""")
        assertEquals(201, post.statusCode())
        val postId = mapper.readTree(post.body()).path("id").asLong()
        assertEquals(403, send(client, "DELETE", "/api/v1/admin/series/$id").statusCode())
        assertEquals(409, send(client, "DELETE", "/api/v1/admin/series/$id", csrf = token).statusCode())
        assertEquals(200, send(client, "GET", "/api/v1/admin/series/$id").statusCode())
        assertEquals(204, send(client, "DELETE", "/api/v1/admin/posts/$postId", csrf = token).statusCode())
        assertEquals(204, send(client, "DELETE", "/api/v1/admin/series/$id", csrf = token).statusCode())
        assertEquals(404, send(client, "GET", "/api/v1/admin/series/$id").statusCode())
    }

    /**
     * 인증 상태 행이 사라지면 기존 세션은 거부하고 새 로그인은 시스템 오류로 중단
     *
     * 1. 정상 로그인 후 복원할 인증 상태와 세션 ID 보관
     * 2. 상태 행 삭제 후 세션 폐기와 로그인 중단 검증
     * 3. 성공·실패 모두 기존 상태 복원
     */
    @Test
    @Order(7)
    fun missingAuthenticationStateInvalidatesSessionAndBlocksLogin() {
        // 정상 세션을 만든 뒤 실패 횟수·잠금 상태를 포함한 원본 행 보관
        val (client, cookies) = newClient()
        assertEquals(200, send(client, "POST", "/api/v1/auth/login", csrf = csrfToken(client), body = loginBody(TEST_PASSWORD)).statusCode())
        val sessionId = decodeSessionId(sessionCookie(cookies))
        val state = jdbc.queryForMap("SELECT config_fingerprint, auth_version, failure_count, locked_until FROM admin_auth_state WHERE id = 1")

        try {
            // 누락된 상태를 null 반환으로 가정하지 않고 실제 0행 조회 경로 재현
            jdbc.update("DELETE FROM admin_auth_state WHERE id = 1")
            assertProblem(send(client, "GET", "/api/v1/auth/me"), 401)
            assertEquals(0, sessionCount(sessionId))
            assertThrows<EmptyResultDataAccessException> { attempts.attempt(TEST_PASSWORD) }
        } finally {
            // 다른 인증 검사에 영향이 없도록 삭제한 상태를 원래 값으로 복원
            jdbc.update(
                "INSERT INTO admin_auth_state (id, config_fingerprint, auth_version, failure_count, locked_until) VALUES (1, ?, ?, ?, ?)",
                state["config_fingerprint"], state["auth_version"], state["failure_count"], state["locked_until"],
            )
        }
    }

    /**
     * 테스트마다 독립적인 브라우저 쿠키 저장소와 HTTP 클라이언트를 생성
     */
    private fun newClient(): Pair<HttpClient, CookieManager> {
        val cookies = CookieManager(null, CookiePolicy.ACCEPT_ALL)
        return HttpClient.newBuilder().cookieHandler(cookies).connectTimeout(Duration.ofSeconds(5)).build() to cookies
    }

    /**
     * 현재 브라우저에 저장된 세션 쿠키 값을 읽음
     */
    private fun sessionCookie(cookies: CookieManager): String = cookies.cookieStore.cookies
        .single { it.name == "KENBLOGSESSION" }.value

    /**
     * Spring Session 쿠키의 Base64 값에서 세션 ID를 복원
     */
    private fun decodeSessionId(cookieValue: String): String = String(Base64.getDecoder().decode(cookieValue), Charsets.UTF_8)

    /**
     * 현재 브라우저 세션 ID에 대응하는 JDBC 행 수를 읽음
     */
    private fun sessionCount(sessionId: String): Int = jdbc.queryForObject(
        "SELECT COUNT(*) FROM SPRING_SESSION WHERE SESSION_ID = ?", Int::class.java, sessionId,
    )!!

    /**
     * 공개 CSRF 경로에서 토큰을 읽고 세션 쿠키를 브라우저 저장소에 남김
     */
    private fun csrfToken(client: HttpClient): String {
        val response = send(client, "GET", "/api/v1/auth/csrf")
        assertEquals(200, response.statusCode())
        assertEquals("X-CSRF-TOKEN", mapper.readTree(response.body()).path("headerName").asString())
        return mapper.readTree(response.body()).path("token").asString()
    }

    /**
     * 테스트 전용 로그인 JSON을 직렬화함
     */
    private fun loginBody(password: String, legacyUsername: String? = null): String =
        mapper.writeValueAsString(mutableMapOf("password" to password).apply {
            if (legacyUsername != null) put("username", legacyUsername)
        })

    /**
     * 실제 로컬 TCP 서버에 요청을 보내고 JSON 또는 빈 응답을 읽음
     */
    private fun send(
        client: HttpClient,
        method: String,
        path: String,
        csrf: String? = null,
        body: String? = null,
        headers: Map<String, String> = emptyMap(),
    ): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(URI("http://127.0.0.1:$port$path"))
            .timeout(Duration.ofSeconds(7))
        builder.header("Accept", "application/json")
        if (body != null) builder.header("Content-Type", "application/json")
        if (csrf != null) builder.header("X-CSRF-TOKEN", csrf)
        headers.forEach { (name, value) -> builder.header(name, value) }
        val request = builder.method(method, if (body == null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body)).build()
        return client.send(request, HttpResponse.BodyHandlers.ofString())
    }

    /**
     * HTTP 오류가 내부 메시지를 배제한 ProblemDetail 상태를 가지는지 검증
     */
    private fun assertProblem(response: HttpResponse<String>, expectedStatus: Int) {
        assertEquals(expectedStatus, response.statusCode())
        assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("application/problem+json"))
        assertEquals(expectedStatus, mapper.readTree(response.body()).path("status").asInt())
        assertFalse(response.body().contains(TEST_PASSWORD))
    }

    /**
     * 공통 상수·도우미
     */
    private companion object {
        /**
         * 테스트용 비밀번호
         */
        const val TEST_PASSWORD = "sample-secret"

        /**
         * 테스트용 비밀번호 해시
         */
        val TEST_HASH = "{bcrypt}" + BCryptPasswordEncoder(10).encode(TEST_PASSWORD)

        /**
         * 인증에서 선택할 테스트 관리자 이름만 지정
         * 계정은 테스트 DB에 직접 등록
         */
        @JvmStatic
        @DynamicPropertySource
        fun adminProperties(registry: DynamicPropertyRegistry) {
            registry.add("app.auth.admin.username") { "testadmin" }
        }
    }
}
