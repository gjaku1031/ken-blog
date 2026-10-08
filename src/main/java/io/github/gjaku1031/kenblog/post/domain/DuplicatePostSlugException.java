package io.github.gjaku1031.kenblog.post.domain;

import io.github.gjaku1031.kenblog.global.error.BusinessException;

import org.springframework.http.HttpStatus;

/**
 * 중복 게시글 주소로 트랜잭션을 롤백하고 외부에는 409 상태로 전달
 */
public final class DuplicatePostSlugException extends BusinessException {
    /**
     * DB 원인을 보존한 주소 중복 오류 초기화
     */
    public DuplicatePostSlugException(Throwable cause) {
        super(HttpStatus.CONFLICT, "이미 사용 중인 게시글 주소입니다.", cause);
    }
}
