package io.github.gjaku1031.kenblog

import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping

/**
 * 프로세스 상태 조회의 HTTP 경로와 OpenAPI 계약을 선언하는 인터페이스.
 *
 * [StatusController]가 이 계약을 구현하며 DB와 외부 서비스 점검은 수행하지 않음.
 */
@RequestMapping("/api/v1/status")
interface StatusApi {
    /**
     * HTTP 요청을 처리할 수 있는 프로세스 상태를 조회.
     *
     * 정상 요청에는 `status=UP`을 담은 [StatusResponse] 반환.
     * 응답 형식 협상 실패와 예상하지 못한 오류는 [ProblemDetail]로 반환.
     */
    @GetMapping(produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "API 프로세스 상태 조회", description = "DB와 외부 서비스 상태를 포함하지 않는 프로세스 응답")
    @ApiResponses(
        value = [
            ApiResponse(
                responseCode = "200",
                description = "프로세스 응답 가능",
                content = [Content(mediaType = MediaType.APPLICATION_JSON_VALUE, schema = Schema(implementation = StatusResponse::class))],
            ),
            ApiResponse(
                responseCode = "405",
                description = "지원하지 않는 HTTP 메서드",
                content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))],
            ),
            ApiResponse(
                responseCode = "406",
                description = "제공할 수 없는 응답 형식",
                content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))],
            ),
            ApiResponse(
                responseCode = "500",
                description = "예상하지 못한 서버 오류",
                content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))],
            ),
        ],
    )
    fun getStatus(): StatusResponse
}
