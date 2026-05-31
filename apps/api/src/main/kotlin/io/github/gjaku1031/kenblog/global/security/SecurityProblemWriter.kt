package io.github.gjaku1031.kenblog.global.security

import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.stereotype.Component
import tools.jackson.databind.ObjectMapper

/**
 * MVC 밖에서 발생하는 인증·접근 거부를 안전한 [ProblemDetail] JSON으로 기록.
 *
 * @property objectMapper Spring MVC와 동일한 JSON 직렬화기
 */
@Component
class SecurityProblemWriter(private val objectMapper: ObjectMapper) {
    /**
     * 응답이 아직 확정되지 않았을 때 고정 설명만 포함한 오류를 반환.
     *
     * @param response 현재 Servlet 응답
     * @param status 공개할 HTTP 상태
     * @throws IllegalStateException 이미 응답이 확정되어 오류로 바꿀 수 없을 때
     */
    fun write(response: HttpServletResponse, status: HttpStatus) {
        check(!response.isCommitted) { "Security response is already committed" }
        response.resetBuffer()
        response.status = status.value()
        response.contentType = MediaType.APPLICATION_PROBLEM_JSON_VALUE
        response.characterEncoding = Charsets.UTF_8.name()
        val detail = when (status) {
            HttpStatus.UNAUTHORIZED -> "인증이 필요합니다."
            HttpStatus.FORBIDDEN -> "접근 권한이 없습니다."
            HttpStatus.SERVICE_UNAVAILABLE -> "세션 저장소를 사용할 수 없습니다."
            else -> "요청을 처리할 수 없습니다."
        }
        objectMapper.writeValue(response.outputStream, ProblemDetail.forStatusAndDetail(status, detail))
    }
}
