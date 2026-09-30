package io.github.gjaku1031.kenblog.web

import io.github.gjaku1031.kenblog.global.security.AccountSessionValidationFilter
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpMethod
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.access.intercept.AuthorizationFilter
import org.springframework.security.web.context.SecurityContextRepository
import org.springframework.security.web.csrf.CsrfTokenRepository
import org.springframework.security.web.savedrequest.NullRequestCache

/** 로그인 폼과 정적 자산만 공개하고 관리자 페이지는 기존 JDBC·MFA 세션으로 보호. */
@Configuration
class ManagementResourceSecurity {
    /** 폼 CSRF, 계정 상태 재검사, ADMIN 권한을 REST 관리자 체인과 동일하게 적용. */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE + 2)
    fun managementAssets(http: HttpSecurity, contextRepository: SecurityContextRepository,
        csrfRepository: CsrfTokenRepository, accountSessionValidationFilter: AccountSessionValidationFilter): SecurityFilterChain = http
        .securityMatcher("/manage", "/manage/**", "/assets/**")
        .csrf { it.csrfTokenRepository(csrfRepository) }
        .securityContext { it.securityContextRepository(contextRepository) }
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED) }
        .requestCache { it.requestCache(NullRequestCache()) }
        .formLogin { it.disable() }
        .httpBasic { it.disable() }
        .logout { it.disable() }
        .exceptionHandling {
            it.authenticationEntryPoint { _, response, _ -> response.sendRedirect("/manage/login") }
        }
        .addFilterBefore(accountSessionValidationFilter, AuthorizationFilter::class.java)
        .authorizeHttpRequests {
            it.requestMatchers(HttpMethod.GET, "/manage/login", "/assets/**").permitAll()
            it.requestMatchers(HttpMethod.POST, "/manage/login").permitAll()
            it.requestMatchers("/manage", "/manage/**").hasRole("ADMIN")
            it.anyRequest().denyAll()
        }
        .build()
}
