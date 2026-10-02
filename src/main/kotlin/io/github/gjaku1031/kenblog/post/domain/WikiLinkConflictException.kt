package io.github.gjaku1031.kenblog.post.domain

import io.github.gjaku1031.kenblog.global.error.BusinessException
import org.springframework.http.HttpStatus

/** 관리자 보정 중 요청한 본문 SHA-256이 현재 Markdown 원문과 다른 HTTP 409 충돌. */
class WikiLinkConflictException : BusinessException(HttpStatus.CONFLICT, "게시글 본문이 변경됐습니다.")
