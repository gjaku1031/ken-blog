package io.github.gjaku1031.kenblog.status.dto

import io.github.gjaku1031.kenblog.status.controller.StatusController

/**
 * [StatusController]의 프로세스 응답을 표현하는 DTO.
 *
 * [status]의 `UP`은 HTTP 처리가 가능한 상태만 뜻하며 DB나 외부 서비스의 상태는 포함하지 않음.
 *
 * @property status 프로세스의 고정 상태값
 */
data class StatusResponse(val status: String)
