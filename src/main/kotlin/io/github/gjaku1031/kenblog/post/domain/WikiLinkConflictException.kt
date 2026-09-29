package io.github.gjaku1031.kenblog.post.domain

/** 관리자 보정 중 요청한 본문 SHA-256이 현재 DB 원문과 다른 HTTP 409 충돌. */
class WikiLinkConflictException : RuntimeException()
