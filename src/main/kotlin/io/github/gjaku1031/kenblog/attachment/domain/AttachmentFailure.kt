package io.github.gjaku1031.kenblog.attachment.domain

import io.github.gjaku1031.kenblog.global.error.BusinessException
import org.springframework.http.HttpStatus

/**
 * 첨부 API에서 외부 입력·상태·저장소 실패를 비밀값 없는 HTTP 상태로 전달.
 *
 * [publicDetail]에는 object key, 공급자 원문, 사용자 파일명을 넣지 않음.
 *
 * 저장 실패 후 보상 정리와 검증 경계의 타입 분기를 위해 하위 타입 유지.
 */
class AttachmentFailure(status: HttpStatus, publicDetail: String) : BusinessException(status, publicDetail)
