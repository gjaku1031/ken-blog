package io.github.gjaku1031.kenblog.web

import org.apache.catalina.connector.Connector
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory
import org.springframework.boot.web.server.WebServerFactoryCustomizer
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import java.nio.file.Path

/** 공개 HTTPS, 호스트 loopback용 HTTP, ACME 전용 HTTP를 같은 JVM의 서로 다른 커넥터로 분리. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = ["app.transport.direct-https"], havingValue = "true")
class DirectHttpsConfiguration {
    /** 기본 HTTPS 커넥터는 Boot SSL bundle을 사용하고 추가 HTTP 두 개는 명시한 포트에만 개설. */
    @Bean
    fun localConnectors(
        @Value("\${server.port}") httpsPort: Int,
        @Value("\${server.ssl.enabled:false}") sslEnabled: Boolean,
        @Value("\${server.forward-headers-strategy:none}") forwarded: String,
        @Value("\${app.transport.local-port:8080}") localPort: Int,
        @Value("\${app.transport.acme-port:8082}") acmePort: Int,
    ): WebServerFactoryCustomizer<TomcatServletWebServerFactory> {
        check(sslEnabled && forwarded.equals("none", ignoreCase = true)) {
            "Direct HTTPS requires native TLS and untrusted forwarding headers"
        }
        check(setOf(httpsPort, localPort, acmePort).size == 3 &&
            listOf(httpsPort, localPort, acmePort).all { it in 1024..65535 }) {
            "HTTPS, local and ACME connectors require distinct unprivileged ports"
        }
        return WebServerFactoryCustomizer { factory ->
            factory.addAdditionalConnectors(httpConnector(localPort, 32), httpConnector(acmePort, 4))
        }
    }

    /** 보안 체인보다 먼저 실제 수신 포트를 검사하며 Host·Forwarded 헤더로 내부 MCP를 가장하지 못하게 함. */
    @Bean
    fun directTransportFilter(
        @Value("\${server.port}") httpsPort: Int,
        @Value("\${app.transport.local-port:8080}") localPort: Int,
        @Value("\${app.transport.acme-port:8082}") acmePort: Int,
        @Value("\${app.transport.acme-webroot}") webroot: String,
    ): FilterRegistrationBean<DirectTransportFilter> = FilterRegistrationBean(
        DirectTransportFilter(httpsPort, localPort, acmePort, Path.of(webroot)),
    ).apply {
        order = Ordered.HIGHEST_PRECEDENCE
        addUrlPatterns("/*")
    }

    /** 추가 HTTP 커넥터의 요청 크기와 스레드를 제한; 호스트 공개 여부는 Compose 포트 바인딩이 담당. */
    private fun httpConnector(port: Int, threads: Int): Connector =
        Connector("org.apache.coyote.http11.Http11NioProtocol").apply {
            this.port = port
            scheme = "http"
            secure = false
            redirectPort = 0
            maxPostSize = 12 * 1024 * 1024
            setProperty("minSpareThreads", "2")
            setProperty("maxThreads", threads.toString())
            setProperty("acceptCount", "64")
            setProperty("maxConnections", "256")
            setProperty("connectionTimeout", "10000")
            setProperty("maxHttpRequestHeaderSize", "8192")
        }
}
