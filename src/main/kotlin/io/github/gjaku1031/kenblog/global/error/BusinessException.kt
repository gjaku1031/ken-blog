package io.github.gjaku1031.kenblog.global.error

import org.springframework.http.HttpStatus

/**
 * 입력·업무 규칙·알려진 자원 장애의 상태와 안전한 공개 설명.
 *
 * 별도 분기나 도메인 의미가 필요하면 기능별 하위 타입 사용.
 * [publicDetail]에는 내부 예외 메시지·SQL·비밀값을 전달하지 않는 계약.
 * 예상하지 못한 결함은 이 타입으로 감싸지 않고 공통 오류 경계에서 처리.
 */
open class BusinessException(
    val status: HttpStatus,
    val publicDetail: String,
    cause: Throwable? = null,
) : RuntimeException(null, cause)
