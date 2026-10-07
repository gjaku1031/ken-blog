package io.github.gjaku1031.kenblog.global.error;

import jakarta.servlet.http.HttpServletRequest;

import lombok.RequiredArgsConstructor;

import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.*;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * Spring MVC 오류의 상태·프로토콜 헤더를 보존한 RFC 9457 응답 경계
 */
@RestControllerAdvice
@RequiredArgsConstructor
public final class ApiErrorHandler extends ResponseEntityExceptionHandler {
    /**
     * 민감 값을 제외한 장애 기록기
     */
    private final SafeFailureLog failures;

    /**
     * 프레임워크 상태·헤더를 보존하고 내부 사유 없는 설명 사용, 확정 응답의 null 결과 유지
     */
    @Override
    protected ResponseEntity<Object> handleExceptionInternal(
            Exception exception,
            Object body,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        return super.handleExceptionInternal(
                exception,
                ProblemDetail.forStatusAndDetail(status, safeHttpDetail(status)),
                headers,
                status,
                request);
    }

    /**
     * 업무·인증·저장소 실패 분류 후 서버 장애 ID와 기존 프로토콜 헤더 결합
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleFailure(
            Exception exception, HttpServletRequest request) {
        var problem = publicProblem(exception);
        if (problem.getStatus() >= 500)
            problem.setProperty("eventId", failures.record(request, exception));
        var response = ResponseEntity.status(problem.getStatus());
        if (exception instanceof ErrorResponse error
                && !DatabaseFailures.isDatabaseConnectionFailure(exception))
            response.headers(error.getHeaders());
        return response.body(problem);
    }

    /**
     * 업무 실패와 알려진 장애 우선 분류, 나머지 내부 원문 비공개
     */
    private ProblemDetail publicProblem(Exception exception) {
        if (exception instanceof BusinessException business)
            return ProblemDetail.forStatusAndDetail(
                    business.getStatus(), business.getPublicDetail());
        if (exception instanceof PessimisticLockingFailureException)
            return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "동시 변경이 충돌했습니다.");
        if (DatabaseFailures.isDatabaseConnectionFailure(exception))
            return ProblemDetail.forStatusAndDetail(
                    HttpStatus.SERVICE_UNAVAILABLE, "데이터베이스에 연결할 수 없습니다.");
        if (exception instanceof AuthenticationException)
            return ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, "인증이 필요합니다.");
        if (exception instanceof ErrorResponse error)
            return ProblemDetail.forStatusAndDetail(
                    error.getStatusCode(), safeHttpDetail(error.getStatusCode()));
        return ProblemDetail.forStatusAndDetail(
                HttpStatus.INTERNAL_SERVER_ERROR, safeHttpDetail(HttpStatus.INTERNAL_SERVER_ERROR));
    }

    /**
     * 요청값·경로·내부 사유 없는 상태별 고정 설명
     */
    private String safeHttpDetail(HttpStatusCode status) {
        if (status.value() == 429) return "로그인 시도가 잠시 제한되었습니다.";
        return status.is4xxClientError() ? "요청을 처리할 수 없습니다." : "서버에서 요청을 처리하지 못했습니다.";
    }
}
