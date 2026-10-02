package io.github.gjaku1031.kenblog.global.error

import org.springframework.dao.PessimisticLockingFailureException
import org.springframework.security.core.AuthenticationException
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
        val safeBody = ProblemDetail.forStatusAndDetail(statusCode, safeHttpDetail(statusCode))
        return super.handleExceptionInternal(ex, safeBody, headers, statusCode, request)
    }

    /** 업무·인증·저장소 실패의 공통 설명 사용. 예상하지 못한 오류 로그에는 타입만 기록. */
    @ExceptionHandler(Exception::class)
    fun handleFailure(ex: Exception): ResponseEntity<ProblemDetail> {
        val problem = publicProblem(ex)
        if (problem.status == HttpStatus.INTERNAL_SERVER_ERROR.value()) {
            logger.error("Unhandled API exception: ${ex.javaClass.name}")
        }
        val response = ResponseEntity.status(problem.status)
        if (ex is ErrorResponse && !ex.isDatabaseConnectionFailure()) response.headers(ex.headers)
        return response.body(problem)
    }

    /** 업무 실패와 알려진 장애를 우선하고 그 밖의 내부 원문은 공개하지 않는 HTTP 분류. */
    private fun publicProblem(ex: Exception): ProblemDetail = when {
        ex is BusinessException -> ProblemDetail.forStatusAndDetail(ex.status, ex.publicDetail)
        ex is PessimisticLockingFailureException -> ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "동시 변경이 충돌했습니다.")
        ex.isDatabaseConnectionFailure() -> ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, "데이터베이스에 연결할 수 없습니다.")
        ex is AuthenticationException -> ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, "인증이 필요합니다.")
        ex is ErrorResponse -> ProblemDetail.forStatusAndDetail(ex.statusCode, safeHttpDetail(ex.statusCode))
        else -> ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, safeHttpDetail(HttpStatus.INTERNAL_SERVER_ERROR))
    }

    /** 프레임워크 상태만 사용하고 요청값·경로·내부 사유를 제외한 고정 설명. */
    private fun safeHttpDetail(status: HttpStatusCode): String = when {
        status.value() == HttpStatus.TOO_MANY_REQUESTS.value() -> "로그인 시도가 잠시 제한되었습니다."
        status.is4xxClientError -> "요청을 처리할 수 없습니다."
        else -> "서버에서 요청을 처리하지 못했습니다."
    }

}
