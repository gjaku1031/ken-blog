package io.github.gjaku1031.kenblog.attachment.domain

import io.github.gjaku1031.kenblog.global.error.BusinessException
import org.springframework.http.HttpStatus

/**
 * 첨부 API에서 외부 입력·상태·저장소 실패를 비밀값 없는 HTTP 상태로 전달
 *
 * [publicDetail]에는 object key, 공급자 원문, 사용자 파일명을 넣지 않음
 *
 * 첨부 연결 검증과 안전한 파일 조회 실패의 기능별 의미를 유지
 */
class AttachmentFailure(status: HttpStatus, publicDetail: String
) : BusinessException(status, publicDetail)
