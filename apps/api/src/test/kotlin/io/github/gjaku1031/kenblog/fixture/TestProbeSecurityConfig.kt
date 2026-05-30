package io.github.gjaku1031.kenblog.fixture

import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.core.annotation.Order
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.web.SecurityFilterChain

/**
 * 운영 경로를 열지 않고 기존 MVC 오류 회귀 테스트 전용 probe만 허용.
 *
 * 운영 JAR에는 포함되지 않으며 `/__test/` 아래 요청에만 우선 적용됨.
 */
@TestConfiguration(proxyBeanMethods = false)
class TestProbeSecurityConfig {
    /**
     * 테스트 probe 경로만 인증·CSRF 없이 MVC 오류 처리 단계까지 전달.
     *
     * @param http 테스트 전용 필터 체인 빌더
     * @return `/__test/` 아래에 한정한 [SecurityFilterChain]
     */
    @Bean
    @Order(1)
    fun testProbeChain(http: HttpSecurity): SecurityFilterChain = http
        .securityMatcher("/__test/**")
        .csrf { it.disable() }
        .authorizeHttpRequests { it.anyRequest().permitAll() }
        .build()
}
