package io.github.gjaku1031.kenblog.fixture;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

/**
 * 운영 경로를 열지 않고 테스트 probe만 허용
 */
@TestConfiguration(proxyBeanMethods = false)
public final class TestProbeSecurityConfig {
    /**
     * 테스트 probe 경로만 인증·CSRF 없이 MVC 오류 처리 단계까지 전달
     *
     * @param http 테스트 전용 필터 체인 빌더
     * @return {@code /__test/} 아래에 한정한 {@link SecurityFilterChain}
     */
    @Bean
    @Order(1)
    public SecurityFilterChain testProbeChain(HttpSecurity http) throws Exception {
        return http.securityMatcher("/__test/**")
                .csrf(config -> config.disable())
                .authorizeHttpRequests(config -> config.anyRequest().permitAll())
                .build();
    }
}
