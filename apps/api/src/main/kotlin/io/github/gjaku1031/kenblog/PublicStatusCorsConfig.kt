package io.github.gjaku1031.kenblog

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.CorsRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

/**
 * 공개 상태 API의 브라우저 교차 출처 읽기를 지정된 프론트 origin에만 허용.
 *
 * `APP_CORS_ALLOWED_ORIGINS`에 해당하는 설정값은 쉼표로 분리하며, 와일드카드나
 * 빈 목록이면 시작 시 오류를 발생시킴. 자격 증명 허용 CORS 헤더는 반환하지 않음.
 *
 * @property allowedOriginsCsv 쉼표로 구분한 허용 origin 설정
 */
@Configuration
class PublicStatusCorsConfig(
    @Value("\${app.cors.allowed-origins}") private val allowedOriginsCsv: String,
) : WebMvcConfigurer {
    /**
     * `/api/v1/status`의 공개 GET과 해당 OPTIONS 사전 요청만 구성.
     *
     * @param registry Spring MVC의 경로별 CORS 등록기
     * @throws IllegalStateException origin 목록이 비었거나 와일드카드를 포함한 경우
     */
    override fun addCorsMappings(registry: CorsRegistry) {
        val origins = allowedOriginsCsv.split(',').map { it.trim() }.filter { it.isNotEmpty() }
        check(origins.isNotEmpty() && origins.none { '*' in it }) { "CORS origins must be explicit" }

        registry.addMapping("/api/v1/status")
            .allowedOrigins(*origins.toTypedArray())
            .allowedMethods("GET")
            .allowedHeaders("Accept")
            .allowCredentials(false)
    }
}
