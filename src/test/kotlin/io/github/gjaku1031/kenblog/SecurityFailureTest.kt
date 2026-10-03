package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.auth.service.AuthService
import io.github.gjaku1031.kenblog.auth.service.LoginSource
import io.github.gjaku1031.kenblog.global.config.SessionCookieConfig
import io.github.gjaku1031.kenblog.global.error.SafeFailureLog
import io.github.gjaku1031.kenblog.global.security.JdbcSessionFailureFilter
import io.github.gjaku1031.kenblog.global.security.SecurityProblemWriter
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.beans.factory.support.DefaultListableBeanFactory
import org.springframework.boot.session.autoconfigure.DefaultCookieSerializerCustomizer
import org.springframework.boot.web.server.autoconfigure.ServerProperties
import org.springframework.jdbc.CannotGetJdbcConnectionException
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.session.web.http.CookieSerializer
import tools.jackson.databind.json.JsonMapper

/**
 * 세션 장애·쿠키·프록시 출처의 Servlet 경계 회귀 검사
 */
@org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension::class)
class SecurityFailureTest {
    /**
     * 세션 로드·응답 저장 시점 장애에서 정상 표현 헤더를 제거하고 공개 오류 반환
     */
    @Test
    fun jdbcFailuresReplaceOnlyUncommittedRepresentations(captured: org.springframework.boot.test.system.CapturedOutput) {
        val filter = JdbcSessionFailureFilter(SecurityProblemWriter(JsonMapper.builder().findAndAddModules().build()), SafeFailureLog())
        for (withImage in listOf(false, true)) {
            val response = MockHttpServletResponse()
            response.setHeader("Access-Control-Allow-Origin", "https://example.org")
            response.setHeader("X-Content-Type-Options", "nosniff")
            filter.doFilter(MockHttpServletRequest(), response) { _, output ->
                val http = output as jakarta.servlet.http.HttpServletResponse
                if (withImage) {
                    http.contentType = "image/png"; http.setContentLengthLong(600)
                    http.setHeader("Content-Disposition", "inline"); http.setHeader("Cache-Control", "public, max-age=3600")
                    http.outputStream.write(byteArrayOf(1, 2, 3))
                }
                throw CannotGetJdbcConnectionException("secret-marker-password-sql")
            }
            assertEquals(503, response.status)
            assertEquals("no-store", response.getHeader("Cache-Control"))
            assertNull(response.getHeader("Content-Length")); assertNull(response.getHeader("Content-Disposition"))
            assertEquals("https://example.org", response.getHeader("Access-Control-Allow-Origin"))
            assertEquals("nosniff", response.getHeader("X-Content-Type-Options"))
            assertTrue(response.contentAsString.contains("eventId"))
            assertFalse(response.contentAsString.contains("secret-marker"))
        }
        val committed = MockHttpServletResponse()
        assertThrows<CannotGetJdbcConnectionException> {
            filter.doFilter(MockHttpServletRequest(), committed) { _, response ->
                response.outputStream.write(byteArrayOf(1)); response.flushBuffer()
                throw CannotGetJdbcConnectionException("secret-marker")
            }
        }
        assertArrayEquals(byteArrayOf(1), committed.contentAsByteArray)
        assertFalse(captured.all.contains("secret-marker"))
    }

    /**
     * 유지 로그인·일반 세션·삭제 쿠키에도 운영 HTTPS·SameSite·Partitioned 설정 적용
     */
    @Test
    fun productionCookieAttributesSurviveRememberAndLogout() {
        val properties = ServerProperties()
        properties.servlet.session.cookie.apply {
            name = "KENBLOGSESSION"; secure = true; httpOnly = true; partitioned = true
            sameSite = org.springframework.boot.web.server.Cookie.SameSite.NONE
        }
        val serializer = SessionCookieConfig().cookieSerializer(properties,
            DefaultListableBeanFactory().getBeanProvider(DefaultCookieSerializerCustomizer::class.java))
        for (remember in listOf(false, true)) {
            val request = MockHttpServletRequest()
            if (remember) request.setAttribute(AuthService.REMEMBER_COOKIE_REQUEST_ATTRIBUTE, true)
            val response = MockHttpServletResponse()
            serializer.writeCookieValue(CookieSerializer.CookieValue(request, response, "test-session"))
            val cookie = response.getHeader("Set-Cookie")!!
            for (attribute in listOf("Secure", "HttpOnly", "SameSite=None", "Partitioned")) assertTrue(cookie.contains(attribute), cookie)
            assertEquals(remember, cookie.contains("Max-Age=2592000"))
            val deleted = MockHttpServletResponse()
            serializer.writeCookieValue(CookieSerializer.CookieValue(request, deleted, "").apply { cookieMaxAge = 0 })
            assertTrue(deleted.getHeader("Set-Cookie")!!.contains("Max-Age=0"))
        }
    }

    /**
     * 클라이언트의 임의 프록시 헤더는 무시하고 인증된 프록시만 출처 분리 가능
     */
    @Test
    fun onlyAuthenticatedProxyHeadersAffectLimits() {
        val source = LoginSource("test-proxy-shared-key-at-least-32-characters")
        val request = MockHttpServletRequest().apply { remoteAddr = "127.0.0.1" }
        val direct = source.key(request)
        request.addHeader("X-Forwarded-For", "203.0.113.9")
        request.addHeader("X-Ken-Blog-Client-IP", "203.0.113.9")
        assertEquals(direct, source.key(request))
        request.addHeader("X-Ken-Blog-Proxy-Key", "test-proxy-shared-key-at-least-32-characters")
        assertNotEquals(direct, source.key(request))
    }
}
