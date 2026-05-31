package io.github.gjaku1031.kenblog.post.domain

import io.github.gjaku1031.kenblog.post.service.PostService

/**
 * [PostService.createDraft]에 전달한 제목·slug·본문이 저장 계약을 충족하지 않을 때 발생.
 *
 * HTTP 응답 계약은 아직 없으며 현재는 내부 서비스 호출자에게 전파됨.
 */
class InvalidPostDraftException(message: String) : RuntimeException(message)

/**
 * 정규화된 slug가 이미 [PostEntity]에 저장되었을 때 발생.
 *
 * [PostService.createDraft]의 트랜잭션을 롤백하도록 호출자에게 전파됨.
 */
class DuplicatePostSlugException(slug: String, cause: Throwable? = null) :
    RuntimeException("이미 사용 중인 slug: $slug", cause)
