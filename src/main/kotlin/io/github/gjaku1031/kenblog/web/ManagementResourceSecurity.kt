package io.github.gjaku1031.kenblog.web

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpMethod
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain

/** 원고나 세션을 포함하지 않은 관리자 정적 화면만 공개하며 변경 API의 인증과 분리. */
@Configuration
class ManagementResourceSecurity {
    /** 로그인 전에도 입력 UI를 내려주되 정적 경로에 대한 쓰기는 허용하지 않음. */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE + 2)
    fun managementAssets(http: HttpSecurity): SecurityFilterChain = http
        .securityMatcher("/manage", "/manage/**", "/assets/**")
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        .requestCache { it.disable() }
        .authorizeHttpRequests {
            it.requestMatchers(HttpMethod.GET, "/manage", "/manage/**", "/assets/**").permitAll()
            it.anyRequest().denyAll()
        }
        .build()
}
