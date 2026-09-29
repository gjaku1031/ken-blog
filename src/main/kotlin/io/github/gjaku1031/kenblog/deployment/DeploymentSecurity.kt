package io.github.gjaku1031.kenblog.deployment

import io.github.gjaku1031.kenblog.global.security.SecurityProblemWriter
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpStatus
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource
import org.springframework.security.web.access.intercept.AuthorizationFilter
import org.springframework.web.filter.OncePerRequestFilter
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/** workflow callback routes에만 세션과 CSRF 대신 검증된 workflow bearer 권한을 적용. */
@Configuration
class DeploymentSecurity {
    /** 기존 관리자 체인보다 먼저 평가되는 콜백 전용 체인을 제공. */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE + 1)
    fun deploymentCallbackChain(
        http: HttpSecurity,
        writer: SecurityProblemWriter,
        @Value("\${app.deployment.callback-token:}") token: String,
    ): SecurityFilterChain = http
        .securityMatcher("/api/v1/deployments/**")
        .csrf { it.disable() }
        .cors { it.disable() }
        .securityContext { it.disable() }
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        .requestCache { it.disable() }
        .formLogin { it.disable() }
        .httpBasic { it.disable() }
        .logout { it.disable() }
        .addFilterBefore(WorkflowBearerFilter(token, writer), AuthorizationFilter::class.java)
        .authorizeHttpRequests { it.anyRequest().hasAuthority("ROLE_DEPLOYMENT_CALLBACK") }
        .build()
}

/** 고정 시간 bearer 비교가 성공한 요청에만 전용 권한을 부여. */
private class WorkflowBearerFilter(private val token: String, private val writer: SecurityProblemWriter) : OncePerRequestFilter() {
    /** 토큰 부재·오류를 401로 끝내고 세션 인증과 결합하지 않음. */
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val authorization = request.getHeader("Authorization") ?: ""
        val supplied = if (authorization.startsWith("Bearer ")) authorization.substring(7) else ""
        val expectedBytes = token.toByteArray(StandardCharsets.UTF_8)
        val actualBytes = supplied.toByteArray(StandardCharsets.UTF_8)
        if (token.isBlank() || !MessageDigest.isEqual(expectedBytes, actualBytes)) {
            writer.write(response, HttpStatus.UNAUTHORIZED)
            return
        }
        val auth = UsernamePasswordAuthenticationToken("deployment-workflow", null,
            listOf(SimpleGrantedAuthority("ROLE_DEPLOYMENT_CALLBACK")))
        auth.details = WebAuthenticationDetailsSource().buildDetails(request)
        SecurityContextHolder.getContext().authentication = auth
        try { chain.doFilter(request, response) } finally { SecurityContextHolder.clearContext() }
    }
}
