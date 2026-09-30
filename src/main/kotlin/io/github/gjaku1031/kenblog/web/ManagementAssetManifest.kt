package io.github.gjaku1031.kenblog.web

import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Component
import tools.jackson.databind.ObjectMapper

/** 프런트 빌드가 기록한 관리자 JS·CSS의 해시 파일명을 템플릿에 제공. */
@Component
class ManagementAssetManifest(private val mapper: ObjectMapper) {
    /** @return 빌드 manifest의 관리자 자산 경로. 예상 밖 파일명은 거부. */
    fun admin(): AdminAssets {
        val resource = ClassPathResource("assets-manifest.json")
        val entry = resource.inputStream.use { mapper.readTree(it).path("admin") }
        val js = entry.path("js").asText()
        val css = entry.path("css").asText()
        check(js.matches(Regex("admin-[A-Za-z0-9_-]+\\.js")) &&
            css.matches(Regex("admin-[A-Za-z0-9_-]+\\.css"))) { "Invalid admin asset manifest" }
        return AdminAssets("/assets/$js", "/assets/$css")
    }
}

/** Thymeleaf의 안전한 정적 자산 링크 두 개. */
data class AdminAssets(val js: String, val css: String)
