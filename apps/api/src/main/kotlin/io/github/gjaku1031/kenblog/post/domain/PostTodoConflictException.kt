package io.github.gjaku1031.kenblog.post.domain

/** 체크박스 변경 전에 공개 원문 해시가 바뀐 HTTP 409 원인. */
class PostTodoConflictException : RuntimeException("본문이 변경됐습니다.")
