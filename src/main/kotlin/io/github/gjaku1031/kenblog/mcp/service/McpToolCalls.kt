package io.github.gjaku1031.kenblog.mcp.service

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import io.github.gjaku1031.kenblog.category.domain.CategoryConflictException
import io.github.gjaku1031.kenblog.category.domain.CategoryNotFoundException
import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException
import io.github.gjaku1031.kenblog.series.domain.*
import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import io.github.gjaku1031.kenblog.post.domain.DuplicatePostSlugException
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.InvalidWikiLinkRequestException
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.domain.WikiLinkConflictException
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import tools.jackson.databind.ObjectMapper

/** 기존 HTTP 도메인 실패를 MCP에서 안전한 구조화 오류로 정규화. */
@Component
class McpToolCalls(private val mapper: ObjectMapper) {
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

    /** API의 [io.github.gjaku1031.kenblog.global.error.ApiErrorHandler] 상태 계약과 일치하는 공개 오류. */
    private fun publicError(ex: Exception): Map<String, String> = when (ex) {
        is OperationFailure -> if (ex.code != null) error(ex.code, ex.publicDetail)
            else fromStatus(ex.status, ex.publicDetail)
        is AttachmentFailure -> fromStatus(ex.status, ex.publicDetail)
        is InvalidPostRequestException,
        is InvalidWikiLinkRequestException, is InvalidCategoryRequestException,
        is InvalidSeriesRequestException ->
            error("validation", "입력값과 본문 선언을 확인하세요.")
        is PostNotFoundException, is CategoryNotFoundException,
        is SeriesNotFoundException ->
            error("not_found", "요청한 콘텐츠를 찾을 수 없습니다.")
        is DuplicatePostSlugException, is CategoryConflictException,
        is SeriesConflictException, is WikiLinkConflictException ->
            error("conflict", "콘텐츠가 변경됐습니다. 최신 내용을 다시 조회하세요.")
        is DataAccessException -> error("unavailable", "데이터 저장소에 연결할 수 없습니다.")
        else -> error("internal", "요청을 처리하지 못했습니다.")
    }

    /** 공개 상태 코드만 MCP 코드로 축약하고 서비스의 안전한 설명만 유지. */
    private fun fromStatus(status: HttpStatus, detail: String): Map<String, String> {
        val code = when (status) {
            HttpStatus.BAD_REQUEST, HttpStatus.UNSUPPORTED_MEDIA_TYPE, HttpStatus.PAYLOAD_TOO_LARGE -> "validation"
            HttpStatus.NOT_FOUND -> "not_found"
            HttpStatus.CONFLICT -> "conflict"
            else -> "unavailable"
        }
        return error(code, detail)
    }

    /** 반환할 공개 코드와 설명만 가진 구조화 오류. */
    private fun error(code: String, message: String): Map<String, String> =
        mapOf("code" to code, "message" to message)
}
