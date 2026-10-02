package io.github.gjaku1031.kenblog.fixture

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

/**
 * 관리자 권한 경계를 실제 HTTP로 시험하는 테스트 전용 Controller.
 *
 * 운영 JAR에는 포함되지 않음.
 */
@RestController
class TestAdminProbeController {
    /**
     * `/api/v1/admin/` 경로의 역할 검사에 성공한 경우만 응답.
     *
     * @return 관리자 접근 성공을 나타내는 테스트 전용 응답
     */
    @GetMapping("/api/v1/admin/__test")
    fun adminOnly(): Map<String, Boolean> = mapOf("authorized" to true)
}
