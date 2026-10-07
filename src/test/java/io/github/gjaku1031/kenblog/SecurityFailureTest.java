package io.github.gjaku1031.kenblog;

import static org.junit.jupiter.api.Assertions.*;

import io.github.gjaku1031.kenblog.auth.service.*;
import io.github.gjaku1031.kenblog.global.config.SessionCookieConfig;
import io.github.gjaku1031.kenblog.global.error.SafeFailureLog;
import io.github.gjaku1031.kenblog.global.security.*;

import jakarta.servlet.http.HttpServletResponse;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.boot.session.autoconfigure.DefaultCookieSerializerCustomizer;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.web.server.Cookie;
import org.springframework.boot.web.server.autoconfigure.ServerProperties;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.mock.web.*;
import org.springframework.session.web.http.CookieSerializer;

import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Objects;

/**
 * 세션 장애·쿠키·프록시 출처의 Servlet 경계 회귀 검사
 */
@ExtendWith(OutputCaptureExtension.class)
final class SecurityFailureTest {
    /**
     * 미확정 세션 장애만 표현 헤더 제거 후 오류 반환, 비밀값 로그 배제
     */
    @Test
    void jdbcFailuresReplaceOnlyUncommittedRepresentations(
            CapturedOutput captured) throws Exception {
        var filter =
                new JdbcSessionFailureFilter(
                        new SecurityProblemWriter(JsonMapper.builder().findAndAddModules().build()),
                        new SafeFailureLog());
        for (boolean withImage : List.of(false, true)) {
            var response = new MockHttpServletResponse();
            response.setHeader("Access-Control-Allow-Origin", "https://example.org");
            response.setHeader("X-Content-Type-Options", "nosniff");
            filter.doFilter(
                    new MockHttpServletRequest(),
                    response,
                    (request, output) -> {
                        var http = (HttpServletResponse) output;
                        if (withImage) {
                            http.setContentType("image/png");
                            http.setContentLengthLong(600);
                            http.setHeader("Content-Disposition", "inline");
                            http.setHeader("Cache-Control", "public, max-age=3600");
                            http.getOutputStream().write(new byte[] {1, 2, 3});
                        }
                        throw new CannotGetJdbcConnectionException("secret-marker-password-sql");
                    });
            assertEquals(503, response.getStatus());
            assertEquals("no-store", response.getHeader("Cache-Control"));
            assertNull(response.getHeader("Content-Length"));
            assertNull(response.getHeader("Content-Disposition"));
            assertEquals("https://example.org", response.getHeader("Access-Control-Allow-Origin"));
            assertEquals("nosniff", response.getHeader("X-Content-Type-Options"));
            assertTrue(response.getContentAsString().contains("eventId"));
            assertFalse(response.getContentAsString().contains("secret-marker"));
        }
        var committed = new MockHttpServletResponse();
        assertThrows(
                CannotGetJdbcConnectionException.class,
                () ->
                        filter.doFilter(
                                new MockHttpServletRequest(),
                                committed,
                                (request, response) -> {
                                    response.getOutputStream().write(new byte[] {1});
                                    response.flushBuffer();
                                    throw new CannotGetJdbcConnectionException("secret-marker");
                                }));
        assertArrayEquals(new byte[] {1}, committed.getContentAsByteArray());
        assertFalse(captured.getAll().contains("secret-marker"));
    }

    /**
     * 기억 로그인·일반·삭제 쿠키의 HTTPS·SameSite·Partitioned 설정 보존
     */
    @Test
    void productionCookieAttributesSurviveRememberAndLogout() {
        var properties = new ServerProperties();
        var settings = properties.getServlet().getSession().getCookie();
        settings.setName("KENBLOGSESSION");
        settings.setSecure(true);
        settings.setHttpOnly(true);
        settings.setPartitioned(true);
        settings.setSameSite(Cookie.SameSite.NONE);
        var serializer =
                new SessionCookieConfig()
                        .cookieSerializer(
                                properties,
                                new DefaultListableBeanFactory()
                                        .getBeanProvider(DefaultCookieSerializerCustomizer.class));
        for (boolean remember : List.of(false, true)) {
            var request = new MockHttpServletRequest();
            if (remember) request.setAttribute(AuthService.REMEMBER_COOKIE_REQUEST_ATTRIBUTE, true);
            var response = new MockHttpServletResponse();
            serializer.writeCookieValue(
                    new CookieSerializer.CookieValue(request, response, "test-session"));
            String cookie = Objects.requireNonNull(response.getHeader("Set-Cookie"));
            for (String attribute : List.of("Secure", "HttpOnly", "SameSite=None", "Partitioned"))
                assertTrue(cookie.contains(attribute), cookie);
            assertEquals(remember, cookie.contains("Max-Age=2592000"));
            var deleted = new MockHttpServletResponse();
            var deletion = new CookieSerializer.CookieValue(request, deleted, "");
            deletion.setCookieMaxAge(0);
            serializer.writeCookieValue(deletion);
            assertTrue(
                    Objects.requireNonNull(deleted.getHeader("Set-Cookie"))
                            .contains("Max-Age=0"));
        }
    }

    /**
     * 임의 프록시 헤더 무시, 인증된 프록시만 출처 분리
     */
    @Test
    void onlyAuthenticatedProxyHeadersAffectLimits() {
        var source = new LoginSource("test-proxy-shared-key-at-least-32-characters");
        var request = new MockHttpServletRequest();
        request.setRemoteAddr("127.0.0.1");
        String direct = source.key(request);
        request.addHeader("X-Forwarded-For", "203.0.113.9");
        request.addHeader("X-Ken-Blog-Client-IP", "203.0.113.9");
        assertEquals(direct, source.key(request));
        request.addHeader("X-Ken-Blog-Proxy-Key", "test-proxy-shared-key-at-least-32-characters");
        assertNotEquals(direct, source.key(request));
    }
}
