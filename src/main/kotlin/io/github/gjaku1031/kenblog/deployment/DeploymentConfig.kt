package io.github.gjaku1031.kenblog.deployment

import tools.jackson.databind.ObjectMapper
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.EnableAspectJAutoProxy
import org.springframework.core.env.Environment
import java.net.URI

/** GitHub 연결 설정을 환경에서 읽되 빈 토큰에서는 dispatch를 확정 실패로 처리. */
@Configuration
@EnableAspectJAutoProxy(proxyTargetClass = true)
class DeploymentConfig {
    /** 배포 요청 및 종료 상태 조회용 GitHub 클라이언트를 제공. */
    @Bean
    fun githubDeploymentClient(
        mapper: ObjectMapper,
        @Value("\${app.deployment.github-token:}") token: String,
        @Value("\${app.deployment.repository:gjaku1031/ken-blog}") repository: String,
        @Value("\${app.deployment.workflow:pages.yml}") workflow: String,
        @Value("\${app.deployment.ref:main}") ref: String,
        @Value("\${app.deployment.pages-marker-url:https://gjaku1031.github.io/ken-blog/deployment.json}") markerUrl: String,
        @Value("\${app.deployment.github-api-base:https://api.github.com}") apiBase: String,
        environment: Environment,
    ): GitHubDeploymentClient {
        val audit = environment.activeProfiles.contains("migration-audit")
        if (apiBase != "https://api.github.com") {
            val uri = URI(apiBase)
            require(audit && uri.scheme == "http" && uri.host in setOf("127.0.0.1", "localhost", "::1") &&
                uri.rawPath.isNullOrEmpty() && uri.rawQuery == null && uri.rawFragment == null)
        }
        val marker = URI(markerUrl)
        require(marker.scheme == "https" || audit && marker.scheme == "http" &&
            marker.host in setOf("127.0.0.1", "localhost", "::1"))
        return GitHubDeploymentClient(mapper, token, repository, workflow, ref, markerUrl, apiBase)
    }
}
