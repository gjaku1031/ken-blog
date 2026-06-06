package io.github.gjaku1031.kenblog.post.domain

import io.github.gjaku1031.kenblog.post.service.PostService

/**
 * [PostService.createDraft]에 전달한 제목·slug·본문이 저장 계약을 충족하지 않을 때 발생.
 *
 * 관리자 HTTP 경계에서는 입력 원문을 숨긴 400 [org.springframework.http.ProblemDetail]로 변환함.
 */
class InvalidPostDraftException(message: String) : RuntimeException(message)

/**
 * 정규화된 slug가 이미 [PostEntity]에 저장되었을 때 발생.
 *
 * [PostService.createDraft]와 [PostService.updateDraft]의 트랜잭션을 롤백하며
 * 관리자 HTTP 경계에서는 slug를 숨긴 409 [org.springframework.http.ProblemDetail]로 변환함.
 */
class DuplicatePostSlugException(slug: String, cause: Throwable? = null) :
    RuntimeException("이미 사용 중인 slug: $slug", cause)

/** 관리자 API의 ID·페이지 경계가 허용 범위를 벗어났을 때 400으로 변환하는 요청 오류. */
class InvalidPostRequestException : RuntimeException()

/** 양수 ID에 해당하는 [PostEntity]가 없어 관리자 API에서 404로 변환하는 조회 오류. */
class PostNotFoundException : RuntimeException()
