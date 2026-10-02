package io.github.gjaku1031.kenblog.post.domain

import io.github.gjaku1031.kenblog.global.error.BusinessException
import org.springframework.http.HttpStatus

/**
 * 등록한 주소가 이미 [PostEntity]에 저장되었을 때 발생
 *
 * [io.github.gjaku1031.kenblog.post.service.PostService.createMetadata]의 트랜잭션을 롤백하며
 * 관리자 HTTP 경계에서는 slug를 숨긴 409 [org.springframework.http.ProblemDetail]로 변환함
 */
class DuplicatePostSlugException(cause: Throwable? = null
) :
    BusinessException(HttpStatus.CONFLICT, "이미 사용 중인 게시글 주소입니다.", cause)

/**
 * 관리자 API의 ID·페이지 경계가 허용 범위를 벗어났을 때 400으로 변환하는 요청 오류
 */
class InvalidPostRequestException : BusinessException(HttpStatus.BAD_REQUEST, "게시글 입력을 확인하세요.")

/**
 * 양수 ID에 해당하는 [PostEntity]가 없어 관리자 API에서 404로 변환하는 조회 오류
 */
class PostNotFoundException : BusinessException(HttpStatus.NOT_FOUND, "게시글을 찾을 수 없습니다.")
