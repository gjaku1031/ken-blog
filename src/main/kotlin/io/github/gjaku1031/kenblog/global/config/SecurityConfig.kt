package io.github.gjaku1031.kenblog.global.config

import io.github.gjaku1031.kenblog.auth.controller.AuthController
import io.github.gjaku1031.kenblog.global.security.AccountSessionValidationFilter
import io.github.gjaku1031.kenblog.global.security.SecurityProblemWriter
import io.github.gjaku1031.kenblog.mcp.transport.McpLocalAccessFilter
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.annotation.Value
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.crypto.factory.PasswordEncoderFactories
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.access.intercept.AuthorizationFilter
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy
import org.springframework.security.web.authentication.session.CompositeSessionAuthenticationStrategy
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy
import org.springframework.security.web.context.HttpSessionSecurityContextRepository
import org.springframework.security.web.context.SecurityContextRepository
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy
import org.springframework.security.web.csrf.CsrfTokenRepository
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository
import org.springframework.security.web.savedrequest.NullRequestCache
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.CorsConfigurationSource
import org.springframework.web.cors.UrlBasedCorsConfigurationSource
import org.springframework.web.filter.OncePerRequestFilter

/**
 * 공개 조회와 인증 경계를 구분하고 JDBC 기반 Servlet 세션 인증을 구성.
 *
 * 로그인과 로그아웃은 [AuthController]에서 수행하며 폼 로그인·Basic 인증은 비활성화.
 */
@Configuration
class SecurityConfig {
    /** 이전 Spring 관리자 화면과 서버 자산 경로는 인증 상태와 관계없이 404. */
    @Bean
    fun retiredWebPathRegistration(): FilterRegistrationBean<OncePerRequestFilter> =
        FilterRegistrationBean<OncePerRequestFilter>(object : OncePerRequestFilter() {
            override fun doFilterInternal(
                request: HttpServletRequest,
                response: HttpServletResponse,
                chain: FilterChain,
            ) {
                val path = request.requestURI
                val retired = listOf("/manage", "/assets", "/write", "/admin")
                    .any { path == it || path.startsWith("$it/") }
                if (retired) {
                    response.setHeader("Cache-Control", "no-store")
                    response.status = HttpStatus.NOT_FOUND.value()
                    return
                }
                chain.doFilter(request, response)
            }
        }).apply {
            order = Ordered.HIGHEST_PRECEDENCE
            addUrlPatterns("/*")
        }

    /** 세션 검증 필터를 Security chain에서만 실행. */
    @Bean
    fun accountSessionValidationRegistration(filter: AccountSessionValidationFilter): FilterRegistrationBean<AccountSessionValidationFilter> =
        FilterRegistrationBean(filter).apply { isEnabled = false }
    /**
     * `/mcp` 전용 체인을 먼저 적용해 브라우저 세션·CSRF 대신 VM 로컬 소켓 경계를 검사.
     *
     * [McpLocalAccessFilter]는 비활성 설정에서 404를, 허용되지 않은 접속에서 403을 반환.
     */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    fun mcpSecurityFilterChain(
        http: HttpSecurity,
        writer: SecurityProblemWriter,
        @Value("\${app.mcp.enabled}") enabled: Boolean,
        @Value("\${app.mcp.allowed-peers}") allowedPeers: String,
        @Value("\${app.mcp.allowed-hosts}") allowedHosts: String,
    ): SecurityFilterChain = http
        .securityMatcher("/mcp", "/mcp/**")
        .csrf { it.disable() }
        .cors { it.disable() }
        .securityContext { it.disable() }
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        .requestCache { it.disable() }
        .formLogin { it.disable() }
        .httpBasic { it.disable() }
        .logout { it.disable() }
        .addFilterBefore(McpLocalAccessFilter(enabled, allowedPeers, allowedHosts, writer), AuthorizationFilter::class.java)
        .authorizeHttpRequests { it.anyRequest().permitAll() }
        .build()

    /**
     * `{bcrypt}` 저장 형식에 맞는 비밀번호 검증기를 제공.
     *
     * @return [io.github.gjaku1031.kenblog.auth.service.AdminLoginAttemptService]가 사용할 [PasswordEncoder]
     */
    @Bean
    fun passwordEncoder(): PasswordEncoder = PasswordEncoderFactories.createDelegatingPasswordEncoder()

    /**
     * 로그인 전후 기대 CSRF 토큰을 MySQL의 HTTP 세션에 저장.
     *
     * @return [AuthController.csrf]와 Security 필터가 공유할 저장소
     */
    @Bean
    fun csrfTokenRepository(): CsrfTokenRepository = HttpSessionCsrfTokenRepository()

    /**
     * 인증 컨텍스트를 HTTP 세션에 명시적으로 저장할 저장소.
     *
     * @return [AuthController.login]과 필터가 공유할 [SecurityContextRepository]
     */
    @Bean
    fun securityContextRepository(): SecurityContextRepository = HttpSessionSecurityContextRepository()

    /**
     * MVC 로그인에서 세션 ID 변경과 기존 CSRF 토큰 제거를 수행.
     *
     * @param csrfRepository 기대 CSRF 토큰 저장소
     * @return 새 인증 성공 시 실행할 [SessionAuthenticationStrategy]
     */
    @Bean
    fun sessionAuthenticationStrategy(csrfRepository: CsrfTokenRepository): SessionAuthenticationStrategy =
        CompositeSessionAuthenticationStrategy(
            listOf(ChangeSessionIdAuthenticationStrategy(), CsrfAuthenticationStrategy(csrfRepository)),
        )

    /**
     * 공개 스냅샷·이미지는 지정 origin의 GET, 관리자 변경은 인증 origin의 credential 요청으로 분리.
     * 관리자 경로의 GET·POST·PUT·PATCH·DELETE와 CSRF 헤더를 허용.
     *
     * @param publicOriginsCsv 공개 상태 조회 허용 origin
     * @param authOriginsCsv 인증 요청을 허용할 명시적 origin; 기본은 빈 목록
     * @return 공개 읽기·관리자 변경 경로를 구분하는 [CorsConfigurationSource]
     * @throws IllegalStateException origin에 와일드카드 또는 형식 오류가 있을 때
     */
    @Bean
    fun corsConfigurationSource(
        @Value("\${app.cors.allowed-origins}") publicOriginsCsv: String,
        @Value("\${app.auth.cors.allowed-origins}") authOriginsCsv: String,
    ): CorsConfigurationSource {
        val publicOrigins = parseOrigins(publicOriginsCsv, allowEmpty = true)
        val authOrigins = parseOrigins(authOriginsCsv, allowEmpty = true)
        val source = UrlBasedCorsConfigurationSource()
        source.registerCorsConfiguration("/api/v1/status", CorsConfiguration().apply {
            allowedOrigins = publicOrigins
            allowedMethods = listOf("GET")
            allowedHeaders = listOf("Accept")
            allowCredentials = false
        })
        val publicPosts = CorsConfiguration().apply {
            allowedOrigins = publicOrigins
            allowedMethods = listOf("GET")
            allowedHeaders = listOf("Accept")
            allowCredentials = false
            maxAge = 600
        }
        val authenticatedPosts = CorsConfiguration().apply {
            allowedOrigins = authOrigins
            allowedMethods = listOf("GET")
            allowedHeaders = listOf("Accept")
            allowCredentials = true
            maxAge = 600
        }
        val adminCors = CorsConfiguration().apply {
            allowedOrigins = authOrigins
            allowedMethods = listOf("GET", "POST", "PUT", "PATCH", "DELETE")
            allowedHeaders = listOf("Accept", "Content-Type", "X-CSRF-TOKEN")
            allowCredentials = true
            maxAge = 600
        }
        if (authOrigins.isNotEmpty()) {
            source.registerCorsConfiguration("/api/v1/auth/**", CorsConfiguration().apply {
                allowedOrigins = authOrigins
                allowedMethods = listOf("GET", "POST")
                allowedHeaders = listOf("Accept", "Content-Type", "X-CSRF-TOKEN")
                allowCredentials = true
                maxAge = 600
            })
        }
        return CorsConfigurationSource { request ->
            val path = request.servletPath
            if (path.startsWith("/api/v1/admin/") || path == "/api/v1/admin") adminCors
            else if (path == "/api/v1/pages/snapshot" || path == "/api/v1/profile/photo" ||
                path.matches(Regex("/api/v1/stack-badges/[0-9]+/image")) ||
                path.matches(Regex("/api/v1/posts/[0-9]+/attachments/[0-9]+/content"))) {
                if (request.getHeader("Origin") in authOrigins) authenticatedPosts else publicPosts
            } else source.getCorsConfiguration(request)
        }
    }

    /**
     * 공개 Pages 스냅샷·이미지와 세션 기반 접근 제어 및 [SecurityProblemWriter]를 연결.
     *
     * @param http Spring Security 설정 빌더
     * @param writer 인증·권한 오류 응답기
     * @param accountSessionValidationFilter DB 계정 상태와 현재 세션 역할을 재검사하는 필터
     * @param contextRepository 세션 인증 컨텍스트 저장소
     * @param csrfRepository 세션 CSRF 토큰 저장소
     * @param corsSource 경로별 CORS 설정
     * @return 완성된 [SecurityFilterChain]
     */
    @Bean
    fun securityFilterChain(
        http: HttpSecurity,
        writer: SecurityProblemWriter,
        accountSessionValidationFilter: AccountSessionValidationFilter,
        contextRepository: SecurityContextRepository,
        csrfRepository: CsrfTokenRepository,
        @Qualifier("corsConfigurationSource") corsSource: CorsConfigurationSource,
    ): SecurityFilterChain = http
        .csrf { it.csrfTokenRepository(csrfRepository) }
        .cors { it.configurationSource(corsSource) }
        .securityContext { it.securityContextRepository(contextRepository) }
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED) }
        .requestCache { it.requestCache(NullRequestCache()) }
        .formLogin { it.disable() }
        .httpBasic { it.disable() }
        .logout { it.disable() }
        .exceptionHandling {
            it.authenticationEntryPoint { _, response, _ -> writer.write(response, HttpStatus.UNAUTHORIZED) }
            it.accessDeniedHandler { _, response, _ -> writer.write(response, HttpStatus.FORBIDDEN) }
        }
        .addFilterBefore(accountSessionValidationFilter, AuthorizationFilter::class.java)
        .authorizeHttpRequests {
            it.requestMatchers(HttpMethod.GET, "/api/v1/status", "/actuator/health", "/api/v1/pages/snapshot").permitAll()
            it.requestMatchers(HttpMethod.GET, "/api/v1/posts/*/attachments/*/content").permitAll()
            it.requestMatchers(HttpMethod.GET, "/api/v1/profile/photo", "/api/v1/stack-badges/*/image").permitAll()
            it.requestMatchers(HttpMethod.GET, "/api/v1/auth/csrf").permitAll()
            it.requestMatchers(HttpMethod.POST, "/api/v1/auth/login").permitAll()
            it.requestMatchers(HttpMethod.GET, "/api/v1/auth/me").authenticated()
            it.requestMatchers(HttpMethod.POST, "/api/v1/auth/logout").authenticated()
            it.requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
            it.anyRequest().authenticated()
        }
        .build()

    /**
     * 쉼표로 구분한 실제 origin 목록만 허용.
     *
     * @param csv 설정 문자열
     * @param allowEmpty 비어 있는 목록 허용 여부
     * @return 원래 순서를 유지한 origin 목록
     * @throws IllegalStateException 허용하지 않는 와일드카드나 URL 형식일 때
     */
    private fun parseOrigins(csv: String, allowEmpty: Boolean): List<String> {
        val origins = csv.split(',').map(String::trim).filter(String::isNotEmpty)
        check(allowEmpty || origins.isNotEmpty()) { "CORS origins must be explicit" }
        check(origins.all { it.matches(Regex("https?://[A-Za-z0-9.-]+(?::[0-9]{1,5})?")) }) {
            "CORS origins must be exact HTTP origins"
        }
        return origins
    }
}
