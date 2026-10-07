package io.github.gjaku1031.kenblog.global.config;

import io.github.gjaku1031.kenblog.auth.service.AuthService;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.session.autoconfigure.DefaultCookieSerializerCustomizer;
import org.springframework.boot.web.server.autoconfigure.ServerProperties;
import org.springframework.context.annotation.*;
import org.springframework.session.web.http.*;

/**
 * 로그인 기억 쿠키에도 서버의 기존 쿠키 보안 설정 적용
 */
@Configuration(proxyBeanMethods = false)
public final class SessionCookieConfig {
    /**
     * Boot의 세션 쿠키 설정을 유지하며 로그인 기억 요청에만 30일 수명을 부여
     *
     * 1. Boot 세션 쿠키 설정 읽기
     * 2. 이름·경로·보안·수명 속성을 직렬화기에 반영
     * 3. 기존 사용자 설정 확장도 지정 순서로 적용
     *
     * @param properties 기존 이름·경로·보안·SameSite·Partitioned 설정
     * @param customizers 다른 세션 쿠키 설정 확장
     * @return {@code AuthService.login}의 기억 여부에 따라 수명을 정하는 직렬화기
     */
    @Bean
    public DefaultCookieSerializer cookieSerializer(
            ServerProperties properties,
            ObjectProvider<DefaultCookieSerializerCustomizer> customizers) {
        var serializer = new RememberLoginCookieSerializer();
        var cookie = properties.getServlet().getSession().getCookie();
        if (cookie.getName() != null) serializer.setCookieName(cookie.getName());
        if (cookie.getDomain() != null) serializer.setDomainName(cookie.getDomain());
        if (cookie.getPath() != null) serializer.setCookiePath(cookie.getPath());
        if (cookie.getHttpOnly() != null) serializer.setUseHttpOnlyCookie(cookie.getHttpOnly());
        if (cookie.getSecure() != null) serializer.setUseSecureCookie(cookie.getSecure());
        if (cookie.getPartitioned() != null) serializer.setPartitioned(cookie.getPartitioned());
        if (cookie.getMaxAge() != null)
            serializer.setCookieMaxAge((int) cookie.getMaxAge().getSeconds());
        if (cookie.getSameSite() != null)
            serializer.setSameSite(cookie.getSameSite().attributeValue());
        customizers.orderedStream().forEach(customizer -> customizer.customize(serializer));
        return serializer;
    }

    /**
     * Spring Session의 무기한 기억 쿠키 대신 정확히 30일 쿠키 기록
     */
    private static final class RememberLoginCookieSerializer extends DefaultCookieSerializer {
        /**
         * {@code AuthService.login}에서 표시한 로그인 응답만 영속 쿠키로 만들며 삭제 쿠키는 그대로 보존
         *
         * @param value 기록할 세션 식별자와 기존 쿠키 수명
         */
        @Override
        public void writeCookieValue(CookieSerializer.CookieValue value) {
            if (value.getCookieMaxAge() < 0
                    && Boolean.TRUE.equals(
                            value.getRequest()
                                    .getAttribute(AuthService.REMEMBER_COOKIE_REQUEST_ATTRIBUTE)))
                value.setCookieMaxAge(AuthService.REMEMBERED_SESSION_TIMEOUT_SECONDS);
            super.writeCookieValue(value);
        }
    }
}
