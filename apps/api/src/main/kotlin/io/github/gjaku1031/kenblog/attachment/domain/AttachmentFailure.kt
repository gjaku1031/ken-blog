package io.github.gjaku1031.kenblog.attachment.domain

import org.springframework.http.HttpStatus

/**
 * 첨부 API에서 외부 입력·상태·저장소 실패를 비밀값 없는 HTTP 상태로 전달.
 *
 * [publicDetail]에는 object key, 공급자 원문, 사용자 파일명을 넣지 않음.
 *
 * @property status 응답 HTTP 상태
 * @property publicDetail 공개 가능한 고정 설명
 */
class AttachmentFailure(val status: HttpStatus, val publicDetail: String) : RuntimeException()
