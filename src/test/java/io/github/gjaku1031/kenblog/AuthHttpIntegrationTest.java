package io.github.gjaku1031.kenblog;

import static org.junit.jupiter.api.Assertions.*;

import io.github.gjaku1031.kenblog.auth.service.*;
import io.github.gjaku1031.kenblog.fixture.*;

import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.session.SessionRepository;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import tools.jackson.databind.ObjectMapper;

import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

/**
 * 실제 서버·MySQL에서 브라우저 쿠키·CSRF·로그인·역할 경계 검증
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "server.servlet.session.cookie.secure=false",
            "app.auth.cors.allowed-origins=http://127.0.0.1:14000",
            "app.cors.allowed-origins=https://gjaku1031.github.io"
        })
@Import({TestMysqlConfig.class, TestAdminProbeController.class})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
final class AuthHttpIntegrationTest {
    /**
     * 테스트 서버 포트
     */
    @LocalServerPort private int port;

    /**
     * JSON 직렬화기
     */
    @Autowired private ObjectMapper mapper;

    /**
     * JDBC 실행기
     */
    @Autowired private JdbcTemplate jdbc;

    /**
     * 인증 상태·로그인 제한 서비스
     */
    @Autowired private AdminLoginAttemptService attempts;

    /**
     * 테스트 세션 저장소
     */
    @Autowired private SessionRepository<?> sessions;

    /**
     * 테스트용 비밀번호
     */
    private static final String TEST_PASSWORD = "sample-secret";

    /**
     * 테스트용 저장 해시
     */
    private static final String TEST_HASH =
            "{bcrypt}" + new BCryptPasswordEncoder(10).encode(TEST_PASSWORD);

    /**
     * 테스트 관리자 이름만 설정, 계정은 격리 DB에 직접 준비
     */
    @DynamicPropertySource
    static void adminProperties(DynamicPropertyRegistry registry) {
        registry.add("app.auth.admin.username", () -> "testadmin");
    }

    /**
     * 운영 자동 생성 없이 격리 DB 계정·실패 상태 초기화
     */
    @BeforeEach
    void prepareAdmin() {
        jdbc.update(
                "INSERT IGNORE INTO users (username, password_hash, role, created_at, enabled)"
                    + " VALUES (?, ?, 'ADMIN', UTC_TIMESTAMP(6), true)",
                "testadmin",
                TEST_HASH);
        jdbc.update(
                "UPDATE users SET password_hash = ?, role = 'ADMIN', enabled = true WHERE username"
                    + " = 'testadmin'",
                TEST_HASH);
        jdbc.update(
                "UPDATE admin_auth_state SET failure_count = 0, locked_until = NULL WHERE id = 1");
        jdbc.update("DELETE FROM admin_login_sources");
    }

    /**
     * 공개 HEAD·CORS와 인증이 필요한 관리자 HEAD 경계
     */
    @Test
    void publicHeadBoundaries() throws Exception {
        var client = newClient().client();
        for (String path : List.of("/actuator/health", "/api/v1/pages/snapshot")) {
            var response = send(client, "HEAD", path);
            assertEquals(200, response.statusCode());
            assertEquals("", response.body());
        }
        for (String path :
                List.of(
                        "/api/v1/posts/999999/attachments/999999/content",
                        "/api/v1/stack-badges/999999/image")) {
            assertEquals(
                    404,
                    send(client, "HEAD", path, null, null, Map.of("Accept", "image/png"))
                            .statusCode());
            assertEquals(
                    200,
                    send(
                                    client,
                                    "OPTIONS",
                                    path,
                                    null,
                                    null,
                                    Map.of(
                                            "Origin",
                                            "https://gjaku1031.github.io",
                                            "Access-Control-Request-Method",
                                            "HEAD"))
                            .statusCode());
        }
        assertEquals(401, send(client, "HEAD", "/api/v1/admin/posts/snapshot").statusCode());
    }

    /**
     * 비활성화·권한 강등·비밀번호 변경 직후 세션 거부
     */
    @Test
    void accountChangesInvalidateExistingSessions() throws Exception {
        for (String change :
                List.of(
                        "enabled = false",
                        "role = 'USER'",
                        "password_hash = CONCAT(password_hash, 'changed')")) {
            prepareAdmin();
            var client = newClient().client();
            assertEquals(
                    200,
                    send(
                                    client,
                                    "POST",
                                    "/api/v1/auth/login",
                                    csrfToken(client),
                                    loginBody(TEST_PASSWORD, "missing"))
                            .statusCode());
            jdbc.update("UPDATE users SET " + change + " WHERE username = 'testadmin'");
            assertEquals(401, send(client, "GET", "/api/v1/auth/me").statusCode());
        }
    }

    /**
     * 기억 로그인 쿠키와 JDBC 30일 수명 일치·로그아웃 행 폐기
     */
    @Test
    void rememberedSessionUsesThirtyDayDatabaseExpiry() throws Exception {
        var browser = newClient();
        var client = browser.client();
        var response =
                send(
                        client,
                        "POST",
                        "/api/v1/auth/login",
                        csrfToken(client),
                        mapper.writeValueAsString(
                                Map.of("password", TEST_PASSWORD, "rememberMe", true)));
        assertEquals(200, response.statusCode());
        assertTrue(
                response.headers().allValues("Set-Cookie").stream()
                        .anyMatch(value -> value.contains("Max-Age=2592000")));
        String id = decodeSessionId(sessionCookie(browser.cookies()));
        assertEquals(
                Duration.ofDays(30),
                Objects.requireNonNull(sessions.findById(id)).getMaxInactiveInterval());
        assertEquals(
                204,
                send(client, "POST", "/api/v1/auth/logout", csrfToken(client), null).statusCode());
        assertEquals(0, sessionCount(id));
    }

    /**
     * 출처별 잠금 격리와 만료 뒤 재검증
     */
    @Test
    void sourceLimitsExpireWithoutLockingOtherClients() {
        for (int index = 0; index < 4; index++)
            assertEquals(AdminLoginResult.Denied.INSTANCE, attempts.attempt("wrong", "source-a"));
        assertEquals(AdminLoginResult.Locked.INSTANCE, attempts.attempt("wrong", "source-a"));
        assertEquals(AdminLoginResult.Locked.INSTANCE, attempts.attempt(TEST_PASSWORD, "source-a"));
        assertInstanceOf(
                AdminLoginResult.Success.class, attempts.attempt(TEST_PASSWORD, "source-b"));
        jdbc.update(
                "UPDATE admin_login_sources SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND"
                    + " WHERE source_key = 'source-a'");
        assertInstanceOf(
                AdminLoginResult.Success.class, attempts.attempt(TEST_PASSWORD, "source-a"));
    }

    /**
     * 동시 실패의 DB 직렬화와 전체 비밀번호 연산 한도
     */
    @Test
    void parallelAttemptsCannotBypassFailureLimits() throws Exception {
        try (var pool = Executors.newFixedThreadPool(6)) {
            var gate = new CountDownLatch(1);
            var futures = new ArrayList<Future<AdminLoginResult>>();
            for (int index = 0; index < 6; index++)
                futures.add(
                        pool.submit(
                                () -> {
                                    gate.await();
                                    return attempts.attempt("wrong", "parallel");
                                }));
            gate.countDown();
            var results = new ArrayList<AdminLoginResult>();
            for (var future : futures) results.add(future.get(15, TimeUnit.SECONDS));
            assertEquals(
                    4,
                    results.stream()
                            .filter(result -> result == AdminLoginResult.Denied.INSTANCE)
                            .count());
            assertEquals(
                    2,
                    results.stream()
                            .filter(result -> result == AdminLoginResult.Locked.INSTANCE)
                            .count());
        }
        jdbc.update(
                "UPDATE admin_auth_state SET failure_count = 30, locked_until = UTC_TIMESTAMP(6) +"
                    + " INTERVAL 60 SECOND WHERE id = 1");
        assertEquals(
                AdminLoginResult.Locked.INSTANCE,
                attempts.attempt(TEST_PASSWORD, "another-source"));
    }

    /**
     * 일반 스키마 재실행·기동 검사는 누락된 인증 상태를 복구하지 않음
     */
    @Test
    void restartNeverRecreatesMissingAuthState() {
        var state = jdbc.queryForMap("SELECT * FROM admin_auth_state WHERE id = 1");
        jdbc.update("DELETE FROM admin_auth_state WHERE id = 1");
        try {
            new ResourceDatabasePopulator(new ClassPathResource("schema.sql"))
                    .execute(Objects.requireNonNull(jdbc.getDataSource()));
            assertEquals(
                    0, jdbc.queryForObject("SELECT COUNT(*) FROM admin_auth_state", Integer.class));
            assertThrows(
                    EmptyResultDataAccessException.class,
                    () -> attempts.run(new DefaultApplicationArguments()));
        } finally {
            restoreState(state);
        }
    }

    /**
     * 관리자 설정이 원래 값으로 돌아와도 옛 세션 버전은 부활하지 않음
     */
    @Test
    void settingsRoundTripDoesNotReviveOldSession() throws Exception {
        var client = newClient().client();
        assertEquals(
                200,
                send(
                                client,
                                "POST",
                                "/api/v1/auth/login",
                                csrfToken(client),
                                loginBody(TEST_PASSWORD, "missing"))
                        .statusCode());
        long before =
                Objects.requireNonNull(
                        jdbc.queryForObject(
                                "SELECT auth_version FROM admin_auth_state WHERE id = 1",
                                Long.class));
        var other = Objects.requireNonNull(new AdminAuthSettings("anotheradmin").configured());
        jdbc.update(
                "UPDATE admin_auth_state SET config_fingerprint = ?, auth_version = auth_version +"
                    + " 1 WHERE id = 1",
                other.fingerprint());
        attempts.run(new DefaultApplicationArguments());
        assertEquals(
                before + 2,
                jdbc.queryForObject(
                        "SELECT auth_version FROM admin_auth_state WHERE id = 1", Long.class));
        assertEquals(401, send(client, "GET", "/api/v1/auth/me").statusCode());
    }

    /**
     * 명시적 복구로 모든 세션 폐기 후 재로그인만 허용
     */
    @Test
    void explicitRecoveryInvalidatesAllSessions() throws Exception {
        var client = newClient().client();
        assertEquals(
                200,
                send(
                                client,
                                "POST",
                                "/api/v1/auth/login",
                                csrfToken(client),
                                loginBody(TEST_PASSWORD, "missing"))
                        .statusCode());
        jdbc.update("DELETE FROM admin_auth_state WHERE id = 1");
        new ResourceDatabasePopulator(new ClassPathResource("recover-auth-state.sql"))
                .execute(Objects.requireNonNull(jdbc.getDataSource()));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM SPRING_SESSION", Integer.class));
        attempts.run(new DefaultApplicationArguments());
        assertEquals(401, send(client, "GET", "/api/v1/auth/me").statusCode());
        assertEquals(
                200,
                send(
                                client,
                                "POST",
                                "/api/v1/auth/login",
                                csrfToken(client),
                                loginBody(TEST_PASSWORD, "missing"))
                        .statusCode());
    }

    /**
     * HTTP 전체 편집의 필수 기준 버전·키와 오래된 요청 거부
     */
    @Test
    void metadataHttpContractRequiresVersionAndAtomicFields() throws Exception {
        var client = newClient().client();
        assertEquals(
                200,
                send(
                                client,
                                "POST",
                                "/api/v1/auth/login",
                                csrfToken(client),
                                loginBody(TEST_PASSWORD, "missing"))
                        .statusCode());
        String token = csrfToken(client);
        var created = send(client, "POST", "/api/v1/admin/posts", token, "{\"title\":\"HTTP 편집\"}");
        assertEquals(201, created.statusCode());
        var row = mapper.readTree(created.body());
        String path = "/api/v1/admin/posts/" + row.path("id").longValue();
        var payload = new LinkedHashMap<String, Object>();
        payload.put("baseVersion", row.path("editVersion").longValue());
        payload.put("title", "원자적 변경");
        payload.put("summary", "요약");
        payload.put("categoryId", null);
        payload.put("tags", List.of("HTTP"));
        payload.put("seriesId", null);
        payload.put("order", null);
        payload.put("relatedSeriesId", null);
        var saved =
                send(
                        client,
                        "PUT",
                        path + "/metadata",
                        token,
                        mapper.writeValueAsString(payload));
        assertEquals(200, saved.statusCode());
        assertEquals(
                405,
                send(client, "PATCH", path + "/metadata", token, mapper.writeValueAsString(payload))
                        .statusCode());
        assertEquals(
                409,
                send(client, "PUT", path + "/metadata", token, mapper.writeValueAsString(payload))
                        .statusCode());
        var missing = new LinkedHashMap<>(payload);
        missing.remove("baseVersion");
        var extra = new LinkedHashMap<>(payload);
        extra.put("unexpected", true);
        for (var invalid : List.of(missing, extra))
            assertEquals(
                    400,
                    send(
                                    client,
                                    "PUT",
                                    path + "/metadata",
                                    token,
                                    mapper.writeValueAsString(invalid))
                            .statusCode());
        var fresh = mapper.readTree(send(client, "GET", path).body());
        assertEquals("원자적 변경", fresh.path("title").stringValue());
        assertEquals(row.path("editVersion").longValue() + 1, fresh.path("editVersion").longValue());
    }

    /**
     * 공개·익명 접근과 origin별 CORS·로컬 쿠키 속성
     */
    @Test
    @Order(1)
    void publicAndAnonymousBoundaries() throws Exception {
        var client = newClient().client();
        var snapshot =
                send(
                        client,
                        "GET",
                        "/api/v1/pages/snapshot",
                        null,
                        null,
                        Map.of("Origin", "https://gjaku1031.github.io"));
        assertEquals(200, snapshot.statusCode());
        assertEquals(
                "https://gjaku1031.github.io",
                snapshot.headers().firstValue("Access-Control-Allow-Origin").orElse(null));
        assertFalse(snapshot.headers().firstValue("Access-Control-Allow-Credentials").isPresent());
        assertEquals(401, send(client, "GET", "/api/v1/auth/me").statusCode());
        assertEquals(401, send(client, "GET", "/api/v1/admin/__test").statusCode());
        var preflight =
                send(
                        client,
                        "OPTIONS",
                        "/api/v1/auth/login",
                        null,
                        null,
                        Map.of(
                                "Origin",
                                "http://127.0.0.1:14000",
                                "Access-Control-Request-Method",
                                "POST",
                                "Access-Control-Request-Headers",
                                "Content-Type,X-CSRF-TOKEN"));
        assertEquals(200, preflight.statusCode());
        assertEquals(
                "true",
                preflight.headers().firstValue("Access-Control-Allow-Credentials").orElse(null));
        var rejected =
                send(
                        client,
                        "OPTIONS",
                        "/api/v1/auth/login",
                        null,
                        null,
                        Map.of(
                                "Origin",
                                "https://gjaku1031.github.io",
                                "Access-Control-Request-Method",
                                "POST"));
        assertEquals(403, rejected.statusCode());
        assertFalse(rejected.headers().firstValue("Access-Control-Allow-Credentials").isPresent());
        var csrf = send(client, "GET", "/api/v1/auth/csrf");
        assertEquals(200, csrf.statusCode());
        assertTrue(
                csrf.headers().allValues("set-cookie").stream()
                        .anyMatch(
                                value ->
                                        value.contains("HttpOnly")
                                                && value.contains("SameSite=Lax")));
        assertFalse(
                csrf.headers().allValues("set-cookie").stream()
                        .anyMatch(value -> value.contains("Secure")));
    }

    /**
     * 로그인 CSRF·세션 ID 교체·비밀값 미저장·로그아웃 후 쿠키·토큰 무효화
     */
    @Test
    @Order(2)
    void loginFixationAndLogout() throws Exception {
        var browser = newClient();
        var client = browser.client();
        String token = csrfToken(client);
        String before = sessionCookie(browser.cookies());
        String body = loginBody(TEST_PASSWORD, "missing");
        assertProblem(send(client, "POST", "/api/v1/auth/login", null, body), 403);
        assertProblem(send(client, "POST", "/api/v1/auth/login", "wrong-token", body), 403);
        var login = send(client, "POST", "/api/v1/auth/login", token, body);
        assertEquals(200, login.statusCode());
        assertEquals("ADMIN", mapper.readTree(login.body()).path("role").asString());
        String after = sessionCookie(browser.cookies());
        assertNotEquals(before, after);
        assertEquals(200, send(client, "GET", "/api/v1/auth/me").statusCode());
        assertProblem(
                send(
                        newClient().client(),
                        "GET",
                        "/api/v1/auth/me",
                        null,
                        null,
                        Map.of("Cookie", "KENBLOGSESSION=" + before)),
                401);
        assertProblem(send(client, "POST", "/api/v1/auth/logout", token, null), 403);
        String id = decodeSessionId(after);
        assertEquals(1, sessionCount(id));
        assertEquals(
                Duration.ofHours(8),
                Objects.requireNonNull(sessions.findById(id)).getMaxInactiveInterval());
        // 세션 직렬화 데이터에 비밀번호 해시가 포함되지 않음
        var serialized =
                jdbc.query(
                        "SELECT a.ATTRIBUTE_BYTES FROM SPRING_SESSION_ATTRIBUTES a JOIN"
                            + " SPRING_SESSION s ON a.SESSION_PRIMARY_ID = s.PRIMARY_ID WHERE"
                            + " s.SESSION_ID = ?",
                        (rs, index) -> rs.getBytes(1),
                        id);
        assertTrue(
                serialized.stream()
                        .noneMatch(
                                bytes ->
                                        new String(bytes, StandardCharsets.ISO_8859_1)
                                                .contains(TEST_HASH)));
        assertEquals(
                204,
                send(client, "POST", "/api/v1/auth/logout", csrfToken(client), null).statusCode());
        assertEquals(0, sessionCount(id));
        assertProblem(
                send(
                        newClient().client(),
                        "GET",
                        "/api/v1/auth/me",
                        null,
                        null,
                        Map.of("Cookie", "KENBLOGSESSION=" + after)),
                401);
    }

    /**
     * 빈·잘못된·BCrypt 바이트 초과 비밀번호의 동일 401 설명
     */
    @Test
    @Order(3)
    void badCredentialsAreIndistinguishable() throws Exception {
        var client = newClient().client();
        String token = csrfToken(client);
        var wrong = send(client, "POST", "/api/v1/auth/login", token, loginBody("wrong"));
        var missing =
                send(
                        client,
                        "POST",
                        "/api/v1/auth/login",
                        token,
                        mapper.writeValueAsString(Map.of("password", "")));
        var tooLong = send(client, "POST", "/api/v1/auth/login", token, loginBody("가".repeat(25)));
        for (var response : List.of(wrong, missing, tooLong)) assertProblem(response, 401);
        assertEquals(
                mapper.readTree(wrong.body()).path("detail").asString(),
                mapper.readTree(missing.body()).path("detail").asString());
        assertEquals(
                mapper.readTree(wrong.body()).path("detail").asString(),
                mapper.readTree(tooLong.body()).path("detail").asString());
    }

    /**
     * 구 요청 USER 이름을 무시하고 설정된 ADMIN만 세션 주체로 사용
     */
    @Test
    @Order(4)
    void userRoleCannotEnterAdminBoundary() throws Exception {
        jdbc.update(
                "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?,"
                    + " 'USER', UTC_TIMESTAMP(6))",
                "testuser",
                TEST_HASH);
        try {
            var client = newClient().client();
            assertEquals(
                    200,
                    send(
                                    client,
                                    "POST",
                                    "/api/v1/auth/login",
                                    csrfToken(client),
                                    loginBody(TEST_PASSWORD, "testuser"))
                            .statusCode());
            var principal = mapper.readTree(send(client, "GET", "/api/v1/auth/me").body());
            assertEquals("testadmin", principal.path("username").asString());
            assertEquals("ADMIN", principal.path("role").asString());
            assertEquals(200, send(client, "GET", "/api/v1/admin/__test").statusCode());
        } finally {
            jdbc.update("DELETE FROM users WHERE username = ?", "testuser");
        }
    }

    /**
     * DB 세션 만료 시 쿠키만으로 인증 복원 거부
     */
    @Test
    @Order(5)
    void expiredSessionCannotBeReused() throws Exception {
        var browser = newClient();
        var client = browser.client();
        assertEquals(
                200,
                send(
                                client,
                                "POST",
                                "/api/v1/auth/login",
                                csrfToken(client),
                                loginBody(TEST_PASSWORD))
                        .statusCode());
        String id = decodeSessionId(sessionCookie(browser.cookies()));
        assertEquals(1, sessionCount(id));
        jdbc.update(
                "UPDATE SPRING_SESSION SET LAST_ACCESS_TIME = 0, EXPIRY_TIME = 0 WHERE SESSION_ID ="
                    + " ?",
                id);
        assertProblem(send(client, "GET", "/api/v1/auth/me"), 401);
    }

    /**
     * 인증·CSRF와 소속 초안 삭제 완료를 시리즈 삭제 전 요구
     */
    @Test
    @Order(6)
    void seriesDeletionRequiresRemovingItsPosts() throws Exception {
        var client = newClient().client();
        assertEquals(
                200,
                send(
                                client,
                                "POST",
                                "/api/v1/auth/login",
                                csrfToken(client),
                                loginBody(TEST_PASSWORD))
                        .statusCode());
        String token = csrfToken(client);
        var created =
                send(
                        client,
                        "POST",
                        "/api/v1/admin/series",
                        token,
                        "{\"kind\":\"TECH\",\"metadata\":{\"name\":\"삭제 제약 시리즈\"}}");
        assertEquals(200, created.statusCode());
        long id = mapper.readTree(created.body()).path("id").asLong();
        var post =
                send(
                        client,
                        "POST",
                        "/api/v1/admin/posts",
                        token,
                        "{\"title\":\"소속 초안\",\"seriesId\":" + id + "}");
        assertEquals(201, post.statusCode());
        long postId = mapper.readTree(post.body()).path("id").asLong();
        assertEquals(403, send(client, "DELETE", "/api/v1/admin/series/" + id).statusCode());
        assertEquals(
                409,
                send(client, "DELETE", "/api/v1/admin/series/" + id, token, null).statusCode());
        assertEquals(200, send(client, "GET", "/api/v1/admin/series/" + id).statusCode());
        assertEquals(
                204,
                send(client, "DELETE", "/api/v1/admin/posts/" + postId, token, null).statusCode());
        assertEquals(
                204,
                send(client, "DELETE", "/api/v1/admin/series/" + id, token, null).statusCode());
        assertEquals(404, send(client, "GET", "/api/v1/admin/series/" + id).statusCode());
    }

    /**
     * 인증 상태 누락 시 기존 세션 폐기·새 로그인 시스템 오류, 검사 뒤 상태 복원
     */
    @Test
    @Order(7)
    void missingAuthenticationStateInvalidatesSessionAndBlocksLogin() throws Exception {
        var browser = newClient();
        var client = browser.client();
        assertEquals(
                200,
                send(
                                client,
                                "POST",
                                "/api/v1/auth/login",
                                csrfToken(client),
                                loginBody(TEST_PASSWORD))
                        .statusCode());
        String id = decodeSessionId(sessionCookie(browser.cookies()));
        var state =
                jdbc.queryForMap(
                        "SELECT config_fingerprint, auth_version, failure_count, locked_until FROM"
                            + " admin_auth_state WHERE id = 1");
        try {
            jdbc.update("DELETE FROM admin_auth_state WHERE id = 1");
            assertProblem(send(client, "GET", "/api/v1/auth/me"), 401);
            assertEquals(0, sessionCount(id));
            assertThrows(
                    EmptyResultDataAccessException.class, () -> attempts.attempt(TEST_PASSWORD, "missing-state"));
        } finally {
            restoreState(state);
        }
    }

    /**
     * 테스트에서 삭제한 원본 인증 상태 복원
     */
    private void restoreState(Map<String, Object> state) {
        jdbc.update(
                "INSERT INTO admin_auth_state (id, config_fingerprint, auth_version, failure_count,"
                    + " locked_until) VALUES (1, ?, ?, ?, ?)",
                state.get("config_fingerprint"),
                state.get("auth_version"),
                state.get("failure_count"),
                state.get("locked_until"));
    }

    /**
     * 독립 브라우저와 쿠키 저장소
     */
    private record Browser(
            /**
             * HTTP 클라이언트
             */
            HttpClient client,

            /**
             * 브라우저 쿠키 저장소
             */
            CookieManager cookies) {}

    /**
     * 테스트마다 독립 쿠키 저장소·클라이언트 생성
     */
    private Browser newClient() {
        var cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        return new Browser(
                HttpClient.newBuilder()
                        .cookieHandler(cookies)
                        .connectTimeout(Duration.ofSeconds(5))
                        .build(),
                cookies);
    }

    /**
     * 브라우저의 유일한 세션 쿠키
     */
    private String sessionCookie(CookieManager cookies) {
        var matching =
                cookies.getCookieStore().getCookies().stream()
                        .filter(cookie -> cookie.getName().equals("KENBLOGSESSION"))
                        .toList();
        assertEquals(1, matching.size());
        return matching.getFirst().getValue();
    }

    /**
     * Base64 쿠키에서 세션 ID 복원
     */
    private String decodeSessionId(String value) {
        return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8);
    }

    /**
     * 세션 ID에 대응하는 JDBC 행 수
     */
    private int sessionCount(String id) {
        return Objects.requireNonNull(
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM SPRING_SESSION WHERE SESSION_ID = ?",
                        Integer.class,
                        id));
    }

    /**
     * 공개 CSRF 토큰 조회와 브라우저 쿠키 저장
     */
    private String csrfToken(HttpClient client) throws Exception {
        var response = send(client, "GET", "/api/v1/auth/csrf");
        assertEquals(200, response.statusCode());
        assertEquals(
                "X-CSRF-TOKEN", mapper.readTree(response.body()).path("headerName").asString());
        return mapper.readTree(response.body()).path("token").asString();
    }

    /**
     * 비밀번호만 담은 로그인 JSON
     */
    private String loginBody(String password) {
        return loginBody(password, null);
    }

    /**
     * 구 사용자명 호환 입력을 포함할 수 있는 로그인 JSON
     */
    private String loginBody(String password, String legacyUsername) {
        var body = new LinkedHashMap<String, String>();
        body.put("password", password);
        if (legacyUsername != null) body.put("username", legacyUsername);
        return mapper.writeValueAsString(body);
    }

    /**
     * 본문·추가 헤더 없는 실제 HTTP 요청
     */
    private HttpResponse<String> send(HttpClient client, String method, String path)
            throws Exception {
        return send(client, method, path, null, null);
    }

    /**
     * CSRF·선택 JSON을 포함한 실제 HTTP 요청
     */
    private HttpResponse<String> send(
            HttpClient client, String method, String path, String csrf, String body)
            throws Exception {
        return send(client, method, path, csrf, body, Map.of());
    }

    /**
     * 실제 로컬 TCP 요청과 JSON 또는 빈 응답 읽기
     */
    private HttpResponse<String> send(
            HttpClient client,
            String method,
            String path,
            String csrf,
            String body,
            Map<String, String> headers)
            throws Exception {
        var builder =
                HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                        .timeout(Duration.ofSeconds(7));
        builder.header("Accept", "application/json");
        if (body != null) builder.header("Content-Type", "application/json");
        if (csrf != null) builder.header("X-CSRF-TOKEN", csrf);
        headers.forEach(builder::header);
        var request =
                builder.method(
                                method,
                                body == null
                                        ? HttpRequest.BodyPublishers.noBody()
                                        : HttpRequest.BodyPublishers.ofString(body))
                        .build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    /**
     * 내부 메시지 없는 ProblemDetail 상태·타입 검증
     */
    private void assertProblem(HttpResponse<String> response, int expected) {
        assertEquals(expected, response.statusCode());
        assertTrue(
                response.headers()
                        .firstValue("Content-Type")
                        .orElse("")
                        .startsWith("application/problem+json"));
        assertEquals(expected, mapper.readTree(response.body()).path("status").asInt());
        assertFalse(response.body().contains(TEST_PASSWORD));
    }
}
