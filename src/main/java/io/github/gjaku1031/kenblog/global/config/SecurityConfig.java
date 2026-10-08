package io.github.gjaku1031.kenblog.global.config;

import io.github.gjaku1031.kenblog.auth.service.AdminLoginAttemptService;
import io.github.gjaku1031.kenblog.global.security.*;
import io.github.gjaku1031.kenblog.global.text.Text;


import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.*;
import org.springframework.http.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.authentication.session.*;
import org.springframework.security.web.context.*;
import org.springframework.security.web.csrf.*;
import org.springframework.security.web.savedrequest.NullRequestCache;
import org.springframework.web.cors.*;

import java.time.Clock;
import java.util.*;

/**
 * 공개 조회와 JDBC 세션 인증 경계 구성, 로그인·로그아웃은 MVC에서 처리
 */
@Configuration(proxyBeanMethods = false)
public final class SecurityConfig {
    /**
     * 세션 검증 필터를 Security chain에서만 실행
     */
    @Bean
    public FilterRegistrationBean<AccountSessionValidationFilter>
            accountSessionValidationRegistration(AccountSessionValidationFilter filter) {
        var registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    /**
     * {@code {bcrypt}} 저장 형식에 맞는 비밀번호 검증기를 제공
     *
     * @return {@link AdminLoginAttemptService}가 사용할 {@link PasswordEncoder}
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    /**
     * 테스트에서 대기 없이 교체할 수 있는 인증 제한 UTC 시계
     */
    @Bean
    public Clock authClock() {
        return Clock.systemUTC();
    }

    /**
     * 로그인 전후 기대 CSRF 토큰을 MySQL의 HTTP 세션에 저장
     *
     * @return {@code AuthController.csrf}와 Security 필터가 공유할 저장소
     */
    @Bean
    public CsrfTokenRepository csrfTokenRepository() {
        return new HttpSessionCsrfTokenRepository();
    }

    /**
     * 인증 컨텍스트를 HTTP 세션에 명시적으로 저장할 저장소
     *
     * @return {@code AuthController.login}과 필터가 공유할 {@link SecurityContextRepository}
     */
    @Bean
    public SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    /**
     * MVC 로그인에서 세션 ID 변경과 기존 CSRF 토큰 제거를 수행
     *
     * @param csrfRepository 기대 CSRF 토큰 저장소
     * @return 새 인증 성공 시 실행할 {@link SessionAuthenticationStrategy}
     */
    @Bean
    public SessionAuthenticationStrategy sessionAuthenticationStrategy(
            CsrfTokenRepository csrfRepository) {
        return new CompositeSessionAuthenticationStrategy(
                List.of(
                        new ChangeSessionIdAuthenticationStrategy(),
                        new CsrfAuthenticationStrategy(csrfRepository)));
    }

    /**
     * 공개 스냅샷·이미지는 지정 origin의 GET, 관리자 변경은 인증 origin의 credential 요청으로 분리
     *
     * 관리자 경로의 GET·POST·PUT·DELETE와 CSRF 헤더를 허용
     *
     * 1. 공개·인증 origin 목록 검증
     * 2. 쿠키 없는 공개 읽기·쿠키 포함 읽기·관리자 변경 정책 분리
     * 3. 설정된 인증 origin이 있을 때만 로그인 경로 등록
     * 4. 요청 경로와 origin에 맞는 CORS 정책 선택
     *
     * @param publicOriginsCsv 공개 스냅샷·이미지 조회 허용 origin
     * @param authOriginsCsv 인증 요청을 허용할 명시적 origin; 기본은 빈 목록
     * @return 공개 읽기·관리자 변경 경로를 구분하는 {@link CorsConfigurationSource}
     * @throws IllegalStateException origin에 와일드카드 또는 형식 오류가 있을 때
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource(
            @Value("${app.cors.allowed-origins}") String publicOriginsCsv,
            @Value("${app.auth.cors.allowed-origins}") String authOriginsCsv) {
        var publicOrigins = parseOrigins(publicOriginsCsv);
        var authOrigins = parseOrigins(authOriginsCsv);
        var source = new UrlBasedCorsConfigurationSource();
        var publicPosts = cors(publicOrigins, List.of("GET", "HEAD"), List.of("Accept"), false);
        var authenticatedPosts = cors(authOrigins, List.of("GET", "HEAD"), List.of("Accept"), true);
        var adminCors =
                cors(
                        authOrigins,
                        List.of("GET", "POST", "PUT", "DELETE"),
                        List.of("Accept", "Content-Type", "X-CSRF-TOKEN"),
                        true);
        if (!authOrigins.isEmpty())
            source.registerCorsConfiguration(
                    "/api/v1/auth/**",
                    cors(
                            authOrigins,
                            List.of("GET", "POST"),
                            List.of("Accept", "Content-Type", "X-CSRF-TOKEN"),
                            true));
        // 요청 경로와 origin에 맞는 정책 선택
        return request -> {
            String path = request.getServletPath();
            if (path.equals("/api/v1/admin/stack-badges")) {
                var config = new CorsConfiguration(authenticatedPosts);
                config.setAllowedMethods(List.of("GET"));
                return config;
            }
            if (path.startsWith("/api/v1/admin/") || path.equals("/api/v1/admin")) return adminCors;
            if (path.equals("/api/v1/pages/snapshot")
                    || path.matches("/api/v1/stack-badges/[0-9]+/image")
                    || path.matches("/api/v1/posts/[0-9]+/attachments/[0-9]+/content"))
                return authOrigins.contains(request.getHeader("Origin"))
                        ? authenticatedPosts
                        : publicPosts;
            return source.getCorsConfiguration(request);
        };
    }

    /**
     * 지정 origin·메서드·헤더와 600초 preflight 수명 구성
     */
    private CorsConfiguration cors(
            List<String> origins, List<String> methods, List<String> headers, boolean credentials) {
        var config = new CorsConfiguration();
        config.setAllowedOrigins(origins);
        config.setAllowedMethods(methods);
        config.setAllowedHeaders(headers);
        config.setAllowCredentials(credentials);
        config.setMaxAge(600L);
        return config;
    }

    /**
     * 공개 Pages 스냅샷·이미지와 세션 기반 접근 제어 및 {@link SecurityProblemWriter}를 연결
     *
     * 1. CSRF·CORS·세션 저장소 설정
     * 2. 사용하지 않는 기본 인증·로그아웃 기능 비활성화
     * 3. 인증·권한 실패를 고정 오류 응답으로 변환
     * 4. 권한 검사 전에 계정·세션 재검증
     * 5. 공개 경로·인증 경로·관리자 경로의 접근 범위 지정
     *
     * @param http Spring Security 설정 빌더
     * @param writer 인증·권한 오류 응답기
     * @param accountFilter DB 계정 상태와 현재 세션 역할을 재검사하는 필터
     * @param contextRepository 세션 인증 컨텍스트 저장소
     * @param csrfRepository 세션 CSRF 토큰 저장소
     * @param corsSource 경로별 CORS 설정
     * @return 완성된 {@link SecurityFilterChain}
     */
    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            SecurityProblemWriter writer,
            AccountSessionValidationFilter accountFilter,
            SecurityContextRepository contextRepository,
            CsrfTokenRepository csrfRepository,
            @Qualifier("corsConfigurationSource") CorsConfigurationSource corsSource)
            throws Exception {
        return http.csrf(config -> config.csrfTokenRepository(csrfRepository))
                .cors(config -> config.configurationSource(corsSource))
                .securityContext(config -> config.securityContextRepository(contextRepository))
                .sessionManagement(
                        config -> config.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .requestCache(config -> config.requestCache(new NullRequestCache()))
                .formLogin(config -> config.disable())
                .httpBasic(config -> config.disable())
                .logout(config -> config.disable())
                .exceptionHandling(
                        config -> {
                            config.authenticationEntryPoint(
                                    (request, response, exception) ->
                                            writer.write(response, HttpStatus.UNAUTHORIZED));
                            config.accessDeniedHandler(
                                    (request, response, exception) ->
                                            writer.write(response, HttpStatus.FORBIDDEN));
                        })
                .addFilterBefore(accountFilter, AuthorizationFilter.class)
                .authorizeHttpRequests(
                        config -> {
                            config.requestMatchers(
                                            HttpMethod.HEAD,
                                            "/actuator/health",
                                            "/api/v1/pages/snapshot",
                                            "/api/v1/posts/*/attachments/*/content",
                                            "/api/v1/stack-badges/*/image")
                                    .permitAll();
                            config.requestMatchers(
                                            HttpMethod.GET,
                                            "/actuator/health",
                                            "/api/v1/pages/snapshot")
                                    .permitAll();
                            config.requestMatchers(
                                            HttpMethod.GET, "/api/v1/posts/*/attachments/*/content")
                                    .permitAll();
                            config.requestMatchers(HttpMethod.GET, "/api/v1/stack-badges/*/image")
                                    .permitAll();
                            config.requestMatchers(HttpMethod.GET, "/api/v1/auth/csrf").permitAll();
                            config.requestMatchers(HttpMethod.POST, "/api/v1/auth/login")
                                    .permitAll();
                            config.requestMatchers(HttpMethod.GET, "/api/v1/auth/me")
                                    .authenticated();
                            config.requestMatchers(HttpMethod.POST, "/api/v1/auth/logout")
                                    .authenticated();
                            config.requestMatchers("/api/v1/admin/**").hasRole("ADMIN");
                            config.anyRequest().authenticated();
                        })
                .build();
    }

    /**
     * 쉼표로 구분한 실제 origin 목록만 허용
     *
     * @param csv 설정 문자열
     * @return 원래 순서를 유지한 origin 목록
     * @throws IllegalStateException 허용하지 않는 와일드카드나 URL 형식일 때
     */
    private List<String> parseOrigins(String csv) {
        var origins =
                Arrays.stream(csv.split(",", -1))
                        .map(Text::trim)
                        .filter(value -> !value.isEmpty())
                        .toList();
        if (origins.stream()
                .anyMatch(value -> !value.matches("https?://[A-Za-z0-9.-]+(?::[0-9]{1,5})?")))
            throw new IllegalStateException("CORS origins must be exact HTTP origins");
        return origins;
    }
}
