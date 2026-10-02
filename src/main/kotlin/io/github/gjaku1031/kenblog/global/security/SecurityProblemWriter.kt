package io.github.gjaku1031.kenblog.global.security

import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.stereotype.Component
import tools.jackson.databind.ObjectMapper

/**
 * MVC 밖에서 발생하는 인증·접근 거부를 안전한 [ProblemDetail] JSON으로 기록
 */
@Component
class SecurityProblemWriter(
    /**
     * JSON 직렬화기
     */
    private val objectMapper: ObjectMapper
) {
    /**
     * 응답이 아직 확정되지 않았을 때 고정 설명만 포함한 오류를 반환
     *
     * 1. 이미 확정된 응답은 변경하지 않고 실패
     * 2. 기존 버퍼를 비우고 오류 상태·JSON 헤더 설정
     * 3. 상태별 고정 설명만 선택해 내부 원문 제외
     * 4. ProblemDetail JSON으로 응답 기록
     *
     * @param response 현재 Servlet 응답
     * @param status 공개할 HTTP 상태
     * @throws IllegalStateException 이미 응답이 확정되어 오류로 바꿀 수 없을 때
     */
    fun write(response: HttpServletResponse, status: HttpStatus) {
        // 이미 확정된 응답은 변경하지 않고 실패
        check(!response.isCommitted) { "Security response is already committed" }
        // 기존 버퍼를 비우고 오류 상태·JSON 헤더 설정
        response.resetBuffer()
        response.status = status.value()
        response.contentType = MediaType.APPLICATION_PROBLEM_JSON_VALUE
        response.characterEncoding = Charsets.UTF_8.name()
        // 상태별 고정 설명만 선택해 내부 원문 제외
        val detail = when (status) {
            HttpStatus.UNAUTHORIZED -> "인증이 필요합니다."
            HttpStatus.FORBIDDEN -> "접근 권한이 없습니다."
            HttpStatus.SERVICE_UNAVAILABLE -> "데이터베이스에 연결할 수 없습니다."
            else -> "요청을 처리할 수 없습니다."
        }
        // ProblemDetail JSON으로 응답 기록
        objectMapper.writeValue(response.outputStream, ProblemDetail.forStatusAndDetail(status, detail))
    }
}
