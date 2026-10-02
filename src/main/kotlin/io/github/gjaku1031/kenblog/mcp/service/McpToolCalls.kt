package io.github.gjaku1031.kenblog.mcp.service

import io.github.gjaku1031.kenblog.global.error.BusinessException
import io.github.gjaku1031.kenblog.global.error.PublicError
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.slf4j.LoggerFactory
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import tools.jackson.databind.ObjectMapper

/** 기존 HTTP 도메인 실패를 MCP에서 안전한 구조화 오류로 정규화. */
@Component
class McpToolCalls(private val mapper: ObjectMapper) {
    private val logger = LoggerFactory.getLogger(javaClass)

    /** MCP의 isError와 구조화 본문을 함께 설정하고 내부 예외 메시지를 제외. */
    fun <T> call(action: () -> T): CallToolResult = try {
        val body = mapOf("ok" to true, "data" to action())
        CallToolResult.builder().isError(false).structuredContent(body)
            .addTextContent(mapper.writeValueAsString(body)).build()
    } catch (ex: Exception) {
        val body = mapOf("ok" to false, "error" to publicError(ex))
        CallToolResult.builder().isError(true).structuredContent(body)
            .addTextContent(mapper.writeValueAsString(body)).build()
    }

    /** HTTP와 같은 공개 설명을 사용하되 기존 MCP 코드와 응답 구조 유지. */
    private fun publicError(ex: Exception): Map<String, String> {
        val failure = PublicError.from(ex)
        if (failure.status == HttpStatus.INTERNAL_SERVER_ERROR) {
            logger.error("Unhandled MCP exception: {}", ex.javaClass.name)
        }
        val code = when (ex) {
            // 같은 HTTP 숫자의 상태 별칭도 동일하게 처리.
            is BusinessException -> when (ex.status.value()) {
                400, 413, 415 -> "validation"
                404 -> "not_found"
                409 -> "conflict"
                else -> "unavailable"
            }
            // 기존 MCP 계약: 모든 DataAccessException은 unavailable. 설명은 실제 원인으로 구분.
            is DataAccessException -> "unavailable"
            else -> "internal"
        }
        return mapOf("code" to code, "message" to failure.detail)
    }
}
