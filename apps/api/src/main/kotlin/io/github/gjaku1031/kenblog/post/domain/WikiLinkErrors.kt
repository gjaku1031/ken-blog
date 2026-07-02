package io.github.gjaku1031.kenblog.post.domain

/** 위키 제목 개수·문자·길이·쿼리 형식이 허용 범위를 벗어나 HTTP 400이 필요한 오류. */
class InvalidWikiLinkRequestException : RuntimeException()
