package io.github.gjaku1031.kenblog.fixture

import io.github.gjaku1031.kenblog.StatusResponse
import io.swagger.v3.oas.annotations.Hidden
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

/**
 * 관리자 권한 경계를 실제 HTTP로 시험하는 테스트 전용 Controller.
 *
 * 운영 JAR와 OpenAPI에는 포함되지 않음.
 */
@Hidden
@RestController
class TestAdminProbeController {
    /**
     * `/api/v1/admin/` 경로의 역할 검사에 성공한 경우만 응답.
     *
     * @return [StatusResponse]의 고정 `UP` 상태
     */
    @GetMapping("/api/v1/admin/__test")
    fun adminOnly(): StatusResponse = StatusResponse("UP")
}
