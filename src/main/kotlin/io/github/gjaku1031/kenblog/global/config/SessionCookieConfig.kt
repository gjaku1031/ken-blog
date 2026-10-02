package io.github.gjaku1031.kenblog.global.config

import io.github.gjaku1031.kenblog.auth.service.AuthService
import org.springframework.beans.factory.ObjectProvider
import org.springframework.boot.session.autoconfigure.DefaultCookieSerializerCustomizer
import org.springframework.boot.web.server.autoconfigure.ServerProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.session.web.http.CookieSerializer
import org.springframework.session.web.http.DefaultCookieSerializer

/**
 * 로그인 기억 쿠키에도 서버의 기존 세션 쿠키 보안 설정을 적용
 */
@Configuration
class SessionCookieConfig {
    /**
     * Boot의 세션 쿠키 설정을 유지하며 로그인 기억 요청에만 30일 수명을 부여
     *
     * 1. Boot 세션 쿠키 설정 읽기
     * 2. 이름·경로·보안·수명 속성을 직렬화기에 반영
     * 3. 기존 사용자 설정 확장도 지정 순서로 적용
     *
     * @param serverProperties 기존 이름·경로·보안·SameSite·Partitioned 설정
     * @param customizers 다른 세션 쿠키 설정 확장
     * @return [AuthService.login]의 기억 여부에 따라 수명을 정하는 직렬화기
     */
    @Bean
    fun cookieSerializer(
        serverProperties: ServerProperties,
        customizers: ObjectProvider<DefaultCookieSerializerCustomizer>,
    ): DefaultCookieSerializer = RememberLoginCookieSerializer().apply {
        // Boot 세션 쿠키 설정 읽기
        val cookie = serverProperties.servlet.session.cookie
        // 이름·경로·보안·수명 속성을 직렬화기에 반영
        cookie.name?.let(::setCookieName)
        cookie.domain?.let(::setDomainName)
        cookie.path?.let(::setCookiePath)
        cookie.httpOnly?.let(::setUseHttpOnlyCookie)
        cookie.secure?.let(::setUseSecureCookie)
        cookie.partitioned?.let(::setPartitioned)
        cookie.maxAge?.let { setCookieMaxAge(it.seconds.toInt()) }
        cookie.sameSite?.let { setSameSite(it.attributeValue()) }
        // 기존 사용자 설정 확장도 지정 순서로 적용
        customizers.orderedStream().forEach { it.customize(this) }
    }
}

/**
 * Spring Session의 무기한 기억 쿠키 대신 정확히 30일 쿠키를 기록
 */
private class RememberLoginCookieSerializer : DefaultCookieSerializer() {
    /**
     * [AuthService.login]에서 표시한 로그인 응답만 영속 쿠키로 만들며 삭제 쿠키는 그대로 보존
     *
     * @param cookieValue 기록할 세션 식별자와 기존 쿠키 수명
     */
    override fun writeCookieValue(cookieValue: CookieSerializer.CookieValue) {
        if (cookieValue.cookieMaxAge < 0 && cookieValue.request.getAttribute(AuthService.REMEMBER_COOKIE_REQUEST_ATTRIBUTE) == true) {
            cookieValue.cookieMaxAge = AuthService.REMEMBERED_SESSION_TIMEOUT_SECONDS
        }
        super.writeCookieValue(cookieValue)
    }
}
