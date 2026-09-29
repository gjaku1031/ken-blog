package io.github.gjaku1031.kenblog.operations.domain

import org.springframework.http.HttpStatus

/** 운영 기능의 검증·충돌·외부 연동 오류를 비밀값 없는 HTTP 상태와 설명으로 전달. */
class OperationFailure(val status: HttpStatus, val publicDetail: String, val code: String? = null) : RuntimeException()
