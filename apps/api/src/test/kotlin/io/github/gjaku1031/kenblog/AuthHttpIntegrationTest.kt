package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.fixture.TestAdminProbeController
import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestMethodOrder
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation
import org.junit.jupiter.api.Order
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.session.SessionRepository
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.GenericContainer
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
 * 실제 서버·MySQL·Redis에서 브라우저 쿠키, CSRF, 로그인과 역할 경계를 검증.
 *
 * Redis 장애 시험은 일시 중지를 사용해 같은 테스트 컨텍스트에서 복구 가능하게 함.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["server.servlet.session.cookie.secure=false", "app.auth.cors.allowed-origins=http://127.0.0.1:14000"],
)
@Import(TestMysqlConfig::class, TestAdminProbeController::class)
@TestMethodOrder(OrderAnnotation::class)
class AuthHttpIntegrationTest {
    @LocalServerPort
    private var port: Int = 0

    @Autowired
    private lateinit var mapper: ObjectMapper

    @Autowired
    private lateinit var jdbc: JdbcTemplate

    @Autowired
    private lateinit var redis: StringRedisTemplate

    @Autowired
    private lateinit var sessions: SessionRepository<*>

    @Autowired
    private lateinit var redisContainer: GenericContainer<*>

    /** 익명 경로와 인증 경로의 CORS·쿠키 정책 및 ProblemDetail을 실제 HTTP로 검증. */
    @Test
    @Order(1)
    fun publicAndAnonymousBoundaries() {
        val client = newClient().first
        val status = send(client, "GET", "/api/v1/status", headers = mapOf("Origin" to "https://gjaku1031.github.io"))
        assertEquals(200, status.statusCode())
        assertEquals("https://gjaku1031.github.io", status.headers().firstValue("Access-Control-Allow-Origin").orElse(null))
        assertFalse(status.headers().firstValue("Access-Control-Allow-Credentials").isPresent)
        assertEquals(401, send(client, "GET", "/api/v1/auth/me").statusCode())
        assertEquals(401, send(client, "GET", "/api/v1/admin/__test").statusCode())

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

        val csrf = send(client, "GET", "/api/v1/auth/csrf")
        assertEquals(200, csrf.statusCode())
        assertTrue(csrf.headers().allValues("set-cookie").any { it.contains("HttpOnly") && it.contains("SameSite=Lax") })
        assertFalse(csrf.headers().allValues("set-cookie").any { it.contains("Secure") })

        val apiDocs = mapper.readTree(send(client, "GET", "/v3/api-docs").body())
        assertEquals("cookie", apiDocs.path("components").path("securitySchemes").path("sessionCookie").path("in").asText())
        assertEquals("KENBLOGSESSION", apiDocs.path("components").path("securitySchemes").path("sessionCookie").path("name").asText())
        assertTrue(apiDocs.path("paths").path("/api/v1/auth/login").path("post").path("parameters")
            .any { it.path("name").asText() == "X-CSRF-TOKEN" && it.path("required").asBoolean() })
    }

    /** 로그인 CSRF, 세션 ID 교체, 로그아웃 후 이전 쿠키와 토큰의 무효화를 검증. */
    @Test
    @Order(2)
    fun loginFixationAndLogout() {
        val (client, cookies) = newClient()
        val token = csrfToken(client)
        val before = sessionCookie(cookies)
        val body = loginBody("testadmin", TEST_PASSWORD)

        assertProblem(send(client, "POST", "/api/v1/auth/login", body = body), 403)
        assertProblem(send(client, "POST", "/api/v1/auth/login", body = body, csrf = "wrong-token"), 403)

        val login = send(client, "POST", "/api/v1/auth/login", body = body, csrf = token)
        assertEquals(200, login.statusCode())
        assertEquals("ADMIN", mapper.readTree(login.body()).path("role").asText())
        val after = sessionCookie(cookies)
        assertNotEquals(before, after)
        assertEquals(200, send(client, "GET", "/api/v1/auth/me").statusCode())
        assertProblem(send(newClient().first, "GET", "/api/v1/auth/me", headers = mapOf("Cookie" to "KENBLOGSESSION=$before")), 401)
        assertProblem(send(client, "POST", "/api/v1/auth/logout", csrf = token), 403)

        val sessionId = decodeSessionId(after)
        val key = sessionKey(sessionId)
        assertTrue(redis.hasKey(key), "Configured Redis session namespace was not used")
        assertEquals(Duration.ofMinutes(30), sessions.findById(sessionId)?.maxInactiveInterval)
        val serialized = redis.connectionFactory!!.connection.use {
            it.hashCommands().hGetAll(key.toByteArray()).values.toList()
        }
        assertTrue(serialized.none { String(it, Charsets.ISO_8859_1).contains(TEST_HASH) })

        val freshToken = csrfToken(client)
        assertEquals(204, send(client, "POST", "/api/v1/auth/logout", csrf = freshToken).statusCode())
        assertFalse(redis.hasKey(key))
        assertProblem(send(newClient().first, "GET", "/api/v1/auth/me", headers = mapOf("Cookie" to "KENBLOGSESSION=$after")), 401)
    }

    /** 없는 계정, 잘못된 비밀번호, BCrypt 바이트 초과 입력이 같은 401 설명인지 검증. */
    @Test
    @Order(3)
    fun badCredentialsAreIndistinguishable() {
        val (client, _) = newClient()
        val token = csrfToken(client)
        val wrong = send(client, "POST", "/api/v1/auth/login", csrf = token, body = loginBody("testadmin", "wrong"))
        val missing = send(client, "POST", "/api/v1/auth/login", csrf = token, body = loginBody("missing", "wrong"))
        val tooLong = send(client, "POST", "/api/v1/auth/login", csrf = token, body = loginBody("testadmin", "가".repeat(25)))
        listOf(wrong, missing, tooLong).forEach { assertProblem(it, 401) }
        assertEquals(mapper.readTree(wrong.body()).path("detail").asText(), mapper.readTree(missing.body()).path("detail").asText())
        assertEquals(mapper.readTree(wrong.body()).path("detail").asText(), mapper.readTree(tooLong.body()).path("detail").asText())
    }

    /** 저장된 USER는 로그인해도 관리자 경로에서 HTTP 403을 받는지 검증. */
    @Test
    @Order(4)
    fun userRoleCannotEnterAdminBoundary() {
        jdbc.update("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'USER', UTC_TIMESTAMP(6))", "testuser", TEST_HASH)
        try {
            val (client, _) = newClient()
            val token = csrfToken(client)
            assertEquals(200, send(client, "POST", "/api/v1/auth/login", csrf = token, body = loginBody("testuser", TEST_PASSWORD)).statusCode())
            assertEquals("USER", mapper.readTree(send(client, "GET", "/api/v1/auth/me").body()).path("role").asText())
            assertProblem(send(client, "GET", "/api/v1/admin/__test"), 403)
        } finally {
            jdbc.update("DELETE FROM users WHERE username = ?", "testuser")
        }
    }

    /** Redis 세션 키 만료 시 브라우저 쿠키만으로 인증이 복원되지 않는지 검증. */
    @Test
    @Order(5)
    fun expiredSessionCannotBeReused() {
        val (client, cookies) = newClient()
        val token = csrfToken(client)
        assertEquals(200, send(client, "POST", "/api/v1/auth/login", csrf = token, body = loginBody("testadmin", TEST_PASSWORD)).statusCode())
        val key = sessionKey(decodeSessionId(sessionCookie(cookies)))
        assertTrue(redis.hasKey(key))
        assertTrue(redis.expire(key, Duration.ofSeconds(1)))
        Thread.sleep(1300)
        assertProblem(send(client, "GET", "/api/v1/auth/me"), 401)
    }

    /** Redis 명령이 지연될 때 세션 조회·CSRF 발급·로그인이 모두 안전한 503을 반환하는지 검증. */
    @Test
    @Order(6)
    fun redisOutageFailsClosed() {
        val (client, _) = newClient()
        val token = csrfToken(client)
        assertEquals(200, send(client, "POST", "/api/v1/auth/login", csrf = token, body = loginBody("testadmin", TEST_PASSWORD)).statusCode())
        val currentToken = csrfToken(client)
        assertEquals(0, redisContainer.execInContainer("redis-cli", "CLIENT", "PAUSE", "9000", "ALL").exitCode)
        assertProblem(send(client, "GET", "/api/v1/auth/me"), 503)
        assertProblem(send(client, "GET", "/api/v1/auth/csrf"), 503)
        assertProblem(send(client, "POST", "/api/v1/auth/login", csrf = currentToken, body = loginBody("testadmin", TEST_PASSWORD)), 503)
        Thread.sleep(4000)
        assertEquals(200, send(client, "GET", "/api/v1/auth/me").statusCode())
    }

    /** 테스트마다 독립적인 브라우저 쿠키 저장소와 HTTP 클라이언트를 생성. */
    private fun newClient(): Pair<HttpClient, CookieManager> {
        val cookies = CookieManager(null, CookiePolicy.ACCEPT_ALL)
        return HttpClient.newBuilder().cookieHandler(cookies).connectTimeout(Duration.ofSeconds(5)).build() to cookies
    }

    /** 현재 브라우저에 저장된 세션 쿠키 값을 읽음. */
    private fun sessionCookie(cookies: CookieManager): String = cookies.cookieStore.cookies
        .single { it.name == "KENBLOGSESSION" }.value

    /** Spring Session 쿠키의 Base64 값에서 세션 ID를 복원. */
    private fun decodeSessionId(cookieValue: String): String = String(Base64.getDecoder().decode(cookieValue), Charsets.UTF_8)

    /** 현재 앱의 세션 namespace와 정확한 세션 ID를 결합한 Redis 키를 반환. */
    private fun sessionKey(sessionId: String): String = "ken-blog:session:sessions:$sessionId"

    /** 공개 CSRF 경로에서 토큰을 읽고 세션 쿠키를 브라우저 저장소에 남김. */
    private fun csrfToken(client: HttpClient): String {
        val response = send(client, "GET", "/api/v1/auth/csrf")
        assertEquals(200, response.statusCode())
        assertEquals("X-CSRF-TOKEN", mapper.readTree(response.body()).path("headerName").asText())
        return mapper.readTree(response.body()).path("token").asText()
    }

    /** 테스트 전용 로그인 JSON을 직렬화함. */
    private fun loginBody(username: String, password: String): String = mapper.writeValueAsString(mapOf("username" to username, "password" to password))

    /** 실제 로컬 TCP 서버에 요청을 보내고 JSON 또는 빈 응답을 읽음. */
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

    /** HTTP 오류가 내부 메시지를 배제한 ProblemDetail 상태를 가지는지 검증. */
    private fun assertProblem(response: HttpResponse<String>, expectedStatus: Int) {
        assertEquals(expectedStatus, response.statusCode())
        assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("application/problem+json"))
        assertEquals(expectedStatus, mapper.readTree(response.body()).path("status").asInt())
        assertFalse(response.body().contains(TEST_PASSWORD))
    }

    private companion object {
        const val TEST_PASSWORD = "sample-secret"
        val TEST_HASH = "{bcrypt}" + BCryptPasswordEncoder(10).encode(TEST_PASSWORD)

        /** 테스트 전용 관리자만 외부 설정으로 준비함. */
        @JvmStatic
        @DynamicPropertySource
        fun adminProperties(registry: DynamicPropertyRegistry) {
            registry.add("app.bootstrap.admin.username") { "testadmin" }
            registry.add("app.bootstrap.admin.password-hash") { TEST_HASH }
        }
    }
}
