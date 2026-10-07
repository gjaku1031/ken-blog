package io.github.gjaku1031.kenblog.global.error;

import org.springframework.http.HttpStatus;

/**
 * 입력·업무 규칙·알려진 자원 장애의 상태와 외부 공개 설명
 * publicDetail에는 내부 예외 메시지·SQL·비밀값을 전달하지 않음
 */
public class BusinessException extends RuntimeException {
    /**
     * HTTP 상태
     */
    private final HttpStatus status;

    /**
     * 외부에 공개할 오류 설명
     */
    private final String publicDetail;

    /**
     * 원인 없는 업무 오류 초기화
     */
    public BusinessException(HttpStatus status, String publicDetail) {
        this(status, publicDetail, null);
    }

    /**
     * 원인을 보존하되 예외 메시지를 외부 설명과 분리
     */
    public BusinessException(HttpStatus status, String publicDetail, Throwable cause) {
        super(null, cause);
        this.status = status;
        this.publicDetail = publicDetail;
    }

    /**
     * HTTP 상태 조회
     */
    public HttpStatus getStatus() {
        return status;
    }

    /**
     * 외부 설명 조회
     */
    public String getPublicDetail() {
        return publicDetail;
    }
}
