package io.github.gjaku1031.kenblog.global.config

import io.github.gjaku1031.kenblog.auth.controller.AuthController
import io.github.gjaku1031.kenblog.global.security.AccountSessionValidationFilter
import io.github.gjaku1031.kenblog.global.security.SecurityProblemWriter
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.annotation.Value
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
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
 * 공개 조회와 인증 경계를 구분하고 JDBC 기반 Servlet 세션 인증을 구성
 *
 * 로그인과 로그아웃은 [AuthController]에서 수행하며 폼 로그인·Basic 인증은 비활성화
 */
@Configuration
class SecurityConfig {
    /**
     * 이전 Spring 관리자 화면과 서버 자산 경로는 인증 상태와 관계없이 404.
     */
    @Bean
    fun retiredWebPathRegistration(): FilterRegistrationBean<OncePerRequestFilter> =
        FilterRegistrationBean<OncePerRequestFilter>(object : OncePerRequestFilter() {
            /**
             * 제거된 화면·자산 경로는 404로 종료하고 나머지 요청 전달
             *
             * 1. 제거된 화면·자산 경로인지 확인
             * 2. 일치하면 캐시를 금지한 404로 종료
             * 3. 나머지 요청만 다음 필터로 전달
             */
            override fun doFilterInternal(
                request: HttpServletRequest,
                response: HttpServletResponse,
                chain: FilterChain,
            ) {
                // 제거된 화면·자산 경로인지 확인
                val path = request.requestURI
                val retired = listOf("/manage", "/assets", "/write", "/admin")
                    .any { path == it || path.startsWith("$it/") }
                // 일치하면 캐시를 금지한 404로 종료
                if (retired) {
                    response.setHeader("Cache-Control", "no-store")
                    response.status = HttpStatus.NOT_FOUND.value()
                    return
                }
                // 나머지 요청만 다음 필터로 전달
                chain.doFilter(request, response)
            }
        }).apply {
            order = Ordered.HIGHEST_PRECEDENCE
            addUrlPatterns("/*")
        }

    /**
     * 세션 검증 필터를 Security chain에서만 실행
     */
    @Bean
    fun accountSessionValidationRegistration(filter: AccountSessionValidationFilter): FilterRegistrationBean<AccountSessionValidationFilter> =
        FilterRegistrationBean(filter).apply { isEnabled = false }

    /**
     * `{bcrypt}` 저장 형식에 맞는 비밀번호 검증기를 제공
     *
     * @return [io.github.gjaku1031.kenblog.auth.service.AdminLoginAttemptService]가 사용할 [PasswordEncoder]
     */
    @Bean
    fun passwordEncoder(): PasswordEncoder = PasswordEncoderFactories.createDelegatingPasswordEncoder()

    /**
     * 인증 제한의 UTC 시계, 테스트에서 대기 없이 대체 가능
     */
    @Bean
    fun authClock(): java.time.Clock = java.time.Clock.systemUTC()

    /**
     * 로그인 전후 기대 CSRF 토큰을 MySQL의 HTTP 세션에 저장
     *
     * @return [AuthController.csrf]와 Security 필터가 공유할 저장소
     */
    @Bean
    fun csrfTokenRepository(): CsrfTokenRepository = HttpSessionCsrfTokenRepository()

    /**
     * 인증 컨텍스트를 HTTP 세션에 명시적으로 저장할 저장소
     *
     * @return [AuthController.login]과 필터가 공유할 [SecurityContextRepository]
     */
    @Bean
    fun securityContextRepository(): SecurityContextRepository = HttpSessionSecurityContextRepository()

    /**
     * MVC 로그인에서 세션 ID 변경과 기존 CSRF 토큰 제거를 수행
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
     * 공개 스냅샷·이미지는 지정 origin의 GET, 관리자 변경은 인증 origin의 credential 요청으로 분리
     *
     * 관리자 경로의 GET·POST·PUT·PATCH·DELETE와 CSRF 헤더를 허용
     *
     * 1. 공개·인증 origin 목록 검증
     * 2. 쿠키 없는 공개 읽기·쿠키 포함 읽기·관리자 변경 정책 분리
     * 3. 설정된 인증 origin이 있을 때만 로그인 경로 등록
     * 4. 요청 경로와 origin에 맞는 CORS 정책 선택
     *
     * @param publicOriginsCsv 공개 스냅샷·이미지 조회 허용 origin
     * @param authOriginsCsv 인증 요청을 허용할 명시적 origin; 기본은 빈 목록
     * @return 공개 읽기·관리자 변경 경로를 구분하는 [CorsConfigurationSource]
     * @throws IllegalStateException origin에 와일드카드 또는 형식 오류가 있을 때
     */
    @Bean
    fun corsConfigurationSource(
        @Value("\${app.cors.allowed-origins}") publicOriginsCsv: String,
        @Value("\${app.auth.cors.allowed-origins}") authOriginsCsv: String,
    ): CorsConfigurationSource {
        // 공개·인증 origin 목록 검증
        val publicOrigins = parseOrigins(publicOriginsCsv, allowEmpty = true)
        val authOrigins = parseOrigins(authOriginsCsv, allowEmpty = true)
        val source = UrlBasedCorsConfigurationSource()
        // 쿠키 없는 공개 읽기·쿠키 포함 읽기·관리자 변경 정책 분리
        val publicPosts = CorsConfiguration().apply {
            allowedOrigins = publicOrigins
            allowedMethods = listOf("GET", "HEAD")
            allowedHeaders = listOf("Accept")
            allowCredentials = false
            maxAge = 600
        }
        val authenticatedPosts = CorsConfiguration().apply {
            allowedOrigins = authOrigins
            allowedMethods = listOf("GET", "HEAD")
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
        // 설정된 인증 origin이 있을 때만 로그인 경로 등록
        if (authOrigins.isNotEmpty()) {
            source.registerCorsConfiguration("/api/v1/auth/**", CorsConfiguration().apply {
                allowedOrigins = authOrigins
                allowedMethods = listOf("GET", "POST")
                allowedHeaders = listOf("Accept", "Content-Type", "X-CSRF-TOKEN")
                allowCredentials = true
                maxAge = 600
            })
        }
        // 요청 경로와 origin에 맞는 CORS 정책 선택
        return CorsConfigurationSource { request ->
            val path = request.servletPath
            if (path == "/api/v1/admin/stack-badges") CorsConfiguration(authenticatedPosts).apply { allowedMethods = listOf("GET") }
            else if (path.startsWith("/api/v1/admin/") || path == "/api/v1/admin") adminCors
            else if (path == "/api/v1/pages/snapshot" ||
                path.matches(Regex("/api/v1/stack-badges/[0-9]+/image")) ||
                path.matches(Regex("/api/v1/posts/[0-9]+/attachments/[0-9]+/content"))) {
                if (request.getHeader("Origin") in authOrigins) authenticatedPosts else publicPosts
            } else source.getCorsConfiguration(request)
        }
    }

    /**
     * 공개 Pages 스냅샷·이미지와 세션 기반 접근 제어 및 [SecurityProblemWriter]를 연결
     *
     * 1. CSRF·CORS·세션 저장소 설정
     * 2. 사용하지 않는 기본 인증·로그아웃 기능 비활성화
     * 3. 인증·권한 실패를 고정 오류 응답으로 변환
     * 4. 권한 검사 전에 계정·세션 재검증
     * 5. 공개 경로·인증 경로·관리자 경로의 접근 범위 지정
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
        // CSRF·CORS·세션 저장소 설정
        .csrf { it.csrfTokenRepository(csrfRepository) }
        .cors { it.configurationSource(corsSource) }
        .securityContext { it.securityContextRepository(contextRepository) }
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED) }
        .requestCache { it.requestCache(NullRequestCache()) }
        // 사용하지 않는 기본 인증·로그아웃 기능 비활성화
        .formLogin { it.disable() }
        .httpBasic { it.disable() }
        .logout { it.disable() }
        // 인증·권한 실패를 고정 오류 응답으로 변환
        .exceptionHandling {
            it.authenticationEntryPoint { _, response, _ -> writer.write(response, HttpStatus.UNAUTHORIZED) }
            it.accessDeniedHandler { _, response, _ -> writer.write(response, HttpStatus.FORBIDDEN) }
        }
        // 권한 검사 전에 계정·세션 재검증
        .addFilterBefore(accountSessionValidationFilter, AuthorizationFilter::class.java)
        // 공개 경로·인증 경로·관리자 경로의 접근 범위 지정
        .authorizeHttpRequests {
            it.requestMatchers(HttpMethod.HEAD, "/actuator/health", "/api/v1/pages/snapshot",
                "/api/v1/posts/*/attachments/*/content", "/api/v1/stack-badges/*/image").permitAll()
            it.requestMatchers(HttpMethod.GET, "/actuator/health", "/api/v1/pages/snapshot").permitAll()
            it.requestMatchers(HttpMethod.GET, "/api/v1/posts/*/attachments/*/content").permitAll()
            it.requestMatchers(HttpMethod.GET, "/api/v1/stack-badges/*/image").permitAll()
            it.requestMatchers(HttpMethod.GET, "/api/v1/auth/csrf").permitAll()
            it.requestMatchers(HttpMethod.POST, "/api/v1/auth/login").permitAll()
            it.requestMatchers(HttpMethod.GET, "/api/v1/auth/me").authenticated()
            it.requestMatchers(HttpMethod.POST, "/api/v1/auth/logout").authenticated()
            it.requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
            it.anyRequest().authenticated()
        }
        .build()

    /**
     * 쉼표로 구분한 실제 origin 목록만 허용
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
