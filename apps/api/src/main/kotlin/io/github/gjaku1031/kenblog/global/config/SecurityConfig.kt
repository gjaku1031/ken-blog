package io.github.gjaku1031.kenblog.global.config

import io.github.gjaku1031.kenblog.auth.controller.AuthController
import io.github.gjaku1031.kenblog.global.security.SecurityProblemWriter
import io.swagger.v3.oas.annotations.enums.SecuritySchemeIn
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType
import io.swagger.v3.oas.annotations.security.SecurityScheme
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.security.authentication.AuthenticationManager
import org.springframework.security.authentication.ProviderManager
import org.springframework.security.authentication.dao.DaoAuthenticationProvider
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.userdetails.UserDetailsService
import org.springframework.security.crypto.factory.PasswordEncoderFactories
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.web.SecurityFilterChain
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
import org.springframework.web.cors.UrlBasedCorsConfigurationSource

/**
 * 공개 조회와 인증 경계를 구분하고 JDBC 기반 Servlet 세션 인증을 구성.
 *
 * 로그인과 로그아웃은 [AuthController]에서 수행하며 폼 로그인·Basic 인증은 비활성화.
 */
@Configuration
@SecurityScheme(name = "sessionCookie", type = SecuritySchemeType.APIKEY, `in` = SecuritySchemeIn.COOKIE, paramName = "KENBLOGSESSION")
class SecurityConfig {
    /**
     * `{bcrypt}` 저장 형식에 맞는 비밀번호 검증기를 제공.
     *
     * @return [DaoAuthenticationProvider]가 사용할 [PasswordEncoder]
     */
    @Bean
    fun passwordEncoder(): PasswordEncoder = PasswordEncoderFactories.createDelegatingPasswordEncoder()

    /**
     * DB 계정 조회와 비밀번호 검증을 결합하고 인증 후 자격 증명을 제거.
     *
     * @param users DB 계정을 로드하는 [UserDetailsService]
     * @param encoder 저장 해시 검증기
     * @return Controller 로그인에서 사용할 [AuthenticationManager]
     */
    @Bean
    fun authenticationManager(users: UserDetailsService, encoder: PasswordEncoder): AuthenticationManager {
        val provider = DaoAuthenticationProvider(users)
        provider.setPasswordEncoder(encoder)
        return ProviderManager(provider).also { it.isEraseCredentialsAfterAuthentication = true }
    }

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
     * 공개 상태 조회는 자격 증명 없이, 인증 경로는 명시한 로컬 origin에만 자격 증명 CORS를 허용.
     *
     * @param publicOriginsCsv 공개 상태 조회 허용 origin
     * @param authOriginsCsv 인증 요청을 허용할 명시적 origin; 기본은 빈 목록
     * @return 필터 단계에서 사용할 경로별 CORS 설정
     * @throws IllegalStateException origin에 와일드카드 또는 형식 오류가 있을 때
     */
    @Bean
    fun corsConfigurationSource(
        @Value("\${app.cors.allowed-origins}") publicOriginsCsv: String,
        @Value("\${app.auth.cors.allowed-origins}") authOriginsCsv: String,
    ): UrlBasedCorsConfigurationSource {
        val publicOrigins = parseOrigins(publicOriginsCsv, allowEmpty = false)
        val authOrigins = parseOrigins(authOriginsCsv, allowEmpty = true)
        val source = UrlBasedCorsConfigurationSource()
        source.registerCorsConfiguration("/api/v1/status", CorsConfiguration().apply {
            allowedOrigins = publicOrigins
            allowedMethods = listOf("GET")
            allowedHeaders = listOf("Accept")
            allowCredentials = false
        })
        if (authOrigins.isNotEmpty()) {
            source.registerCorsConfiguration("/api/v1/auth/**", CorsConfiguration().apply {
                allowedOrigins = authOrigins
                allowedMethods = listOf("GET", "POST")
                allowedHeaders = listOf("Accept", "Content-Type", "X-CSRF-TOKEN")
                allowCredentials = true
                maxAge = 600
            })
        }
        return source
    }

    /**
     * API의 공개 경로와 세션 기반 접근 제어 및 [SecurityProblemWriter]를 연결.
     *
     * @param http Spring Security 설정 빌더
     * @param writer 인증·권한 오류 응답기
     * @param contextRepository 세션 인증 컨텍스트 저장소
     * @param csrfRepository 세션 CSRF 토큰 저장소
     * @param corsSource 경로별 CORS 설정
     * @return 완성된 [SecurityFilterChain]
     */
    @Bean
    fun securityFilterChain(
        http: HttpSecurity,
        writer: SecurityProblemWriter,
        contextRepository: SecurityContextRepository,
        csrfRepository: CsrfTokenRepository,
        corsSource: UrlBasedCorsConfigurationSource,
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
        .authorizeHttpRequests {
            it.requestMatchers(HttpMethod.GET, "/api/v1/status", "/actuator/health", "/v3/api-docs", "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
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
