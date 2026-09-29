package io.github.gjaku1031.kenblog.status.controller

import io.github.gjaku1031.kenblog.status.dto.StatusResponse
import org.springframework.web.bind.annotation.RestController

/**
 * [StatusApi]의 프로세스 상태 조회를 실제 HTTP 응답으로 구현하는 Controller.
 *
 * 요청마다 고정 상태를 반환하며 하위 시스템의 가용성은 조회하지 않음.
 */
@RestController
class StatusController : StatusApi {
    /**
     * API 프로세스가 요청을 처리하면 `UP` 상태를 반환.
     *
     * @return `status=UP`인 [StatusResponse]
     */
    override fun getStatus(): StatusResponse = StatusResponse(status = "UP")
}
