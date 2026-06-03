package io.github.gjaku1031.kenblog.global.error

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import io.github.gjaku1031.kenblog.global.security.isDatabaseConnectionFailure
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.HttpStatusCode
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.security.core.AuthenticationException
import org.springframework.web.ErrorResponse
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.context.request.WebRequest
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler

/**
 * Spring MVC 오류를 RFC 9457 본문으로 변환하는 공통 경계.
 *
 * [ResponseEntityExceptionHandler]의 상태와 프로토콜 헤더를 유지하고,
 * 프레임워크 예외의 원문 대신 공개 가능한 고정 설명을 사용함.
 */
@RestControllerAdvice
class ApiErrorHandler : ResponseEntityExceptionHandler() {
    /**
     * 첨부 계약의 공개 가능한 오류만 [ProblemDetail]로 전달.
     *
     * @param ex 내부 key·공급자 원문을 담지 않은 첨부 오류
     * @return 오류별 400·404·409·413·415·503 상태
     */
    @ExceptionHandler(AttachmentFailure::class)
    fun handleAttachment(ex: AttachmentFailure): ResponseEntity<ProblemDetail> =
        ResponseEntity.status(ex.status).body(ProblemDetail.forStatusAndDetail(ex.status, ex.publicDetail))

    /**
     * 계정 오류는 동일한 401, DB 연결 장애만 안전한 503을 반환.
     *
     * @param ex 인증 제공자의 실패; 내부 메시지는 사용하지 않음
     * @return 고정 설명의 [ProblemDetail] 응답
     */
    @ExceptionHandler(AuthenticationException::class)
    fun handleAuthentication(ex: AuthenticationException): ResponseEntity<ProblemDetail> {
        if (ex.isDatabaseConnectionFailure()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, "데이터베이스에 연결할 수 없습니다."))
        }
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, "인증이 필요합니다."))
    }

    /**
     * Spring MVC 오류의 상태와 헤더를 보존하면서 안전한 설명을 반환.
     *
     * 프레임워크 예외의 입력값·내부 메시지는 공개하지 않음.
     * 이미 응답이 확정되었다면 상위 구현의 `null` 결과를 그대로 전달.
     *
     * @param ex MVC가 전달한 예외
     * @param body Spring이 구성한 오류 본문. 원문 노출을 막기 위해 사용하지 않음
     * @param headers 원래 오류 응답의 프로토콜 헤더
     * @param statusCode 원래 오류 상태
     * @param request 현재 웹 요청
     * @return 원래 상태·헤더와 안전한 [ProblemDetail] 본문을 가진 응답
     */
    override fun handleExceptionInternal(
        ex: Exception,
        body: Any?,
        headers: HttpHeaders,
        statusCode: HttpStatusCode,
        request: WebRequest,
    ): ResponseEntity<Any>? {
        val safeBody = ProblemDetail.forStatusAndDetail(statusCode, publicDetail(statusCode))
        return super.handleExceptionInternal(ex, safeBody, headers, statusCode, request)
    }

    /**
     * DB 연결 장애는 503, 그 밖의 처리되지 않은 앱 예외는 안전한 500으로 변환.
     *
     * Spring MVC 자체 예외는 상위 [ResponseEntityExceptionHandler]의 더 구체적인
     * 처리 경로에서 상태와 헤더를 보존함. 그 밖의 [ErrorResponse]도 원래 상태와
     * 헤더를 유지하고, 앱의 일반 예외에만 HTTP 500을 사용함.
     *
     * @param ex 처리되지 않은 예외. 예외 메시지는 응답과 로그에 포함하지 않음
     * @return 고정 설명을 가진 HTTP 503 또는 500 [ProblemDetail] 응답
     */
    @ExceptionHandler(Exception::class)
    fun handleUnexpected(ex: Exception): ResponseEntity<ProblemDetail> {
        if (ex.isDatabaseConnectionFailure()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, "데이터베이스에 연결할 수 없습니다."))
        }
        if (ex is ErrorResponse) {
            val problem = ProblemDetail.forStatusAndDetail(ex.statusCode, publicDetail(ex.statusCode))
            return ResponseEntity.status(ex.statusCode).headers(ex.headers).body(problem)
        }
        logger.error("Unhandled API exception: ${ex.javaClass.name}")
        val problem = ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, publicDetail(HttpStatus.INTERNAL_SERVER_ERROR))
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(problem)
    }

    /**
     * HTTP 상태에 맞는 고정 공개 설명을 제공.
     *
     * 요청 경로, 입력값, 예외 메시지와 무관한 문자열만 반환.
     *
     * @param statusCode 오류의 HTTP 상태
     * @return 4xx 또는 5xx에 사용할 공개 설명
     */
    private fun publicDetail(statusCode: HttpStatusCode): String =
        if (statusCode.is4xxClientError) "요청을 처리할 수 없습니다." else "서버에서 요청을 처리하지 못했습니다."
}
