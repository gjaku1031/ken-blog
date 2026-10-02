package io.github.gjaku1031.kenblog.global.error

import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.HttpStatusCode
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.web.ErrorResponse
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.context.request.WebRequest
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler

/** Spring MVC 오류를 상태·프로토콜 헤더를 보존한 RFC 9457 본문으로 변환하는 경계. */
@RestControllerAdvice
class ApiErrorHandler : ResponseEntityExceptionHandler() {
    /**
     * Spring MVC의 상태와 헤더를 유지하고 입력값·내부 사유를 제외한 설명 사용.
     * 이미 응답이 확정된 경우 상위 구현의 null 결과 유지.
     */
    override fun handleExceptionInternal(
        ex: Exception,
        body: Any?,
        headers: HttpHeaders,
        statusCode: HttpStatusCode,
        request: WebRequest,
    ): ResponseEntity<Any>? {
        val safeBody = ProblemDetail.forStatusAndDetail(statusCode, PublicError.safeHttpDetail(statusCode))
        return super.handleExceptionInternal(ex, safeBody, headers, statusCode, request)
    }

    /** 업무·인증·저장소 실패의 공통 설명 사용. 예상하지 못한 오류 로그에는 타입만 기록. */
    @ExceptionHandler(Exception::class)
    fun handleFailure(ex: Exception): ResponseEntity<ProblemDetail> {
        val error = PublicError.from(ex)
        if (error.status == HttpStatus.INTERNAL_SERVER_ERROR) {
            logger.error("Unhandled API exception: ${ex.javaClass.name}")
        }
        val response = ResponseEntity.status(error.status)
        if (ex is ErrorResponse && !ex.isDatabaseConnectionFailure()) response.headers(ex.headers)
        return response.body(ProblemDetail.forStatusAndDetail(error.status, error.detail))
    }
}
