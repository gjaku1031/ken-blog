package io.github.gjaku1031.kenblog.member.dto

import io.github.gjaku1031.kenblog.account.domain.UserRole
import java.time.LocalDateTime

/** 관리자 회원 발급 입력. */
data class CreateMemberRequest(val name: String, val email: String, val role: UserRole = UserRole.USER)

/** 암호·초대 토큰 없이 관리자에게 보여 주는 회원 행. */
data class MemberResponse(
    val id: Long,
    val name: String,
    val email: String,
    val role: UserRole,
    val createdAt: LocalDateTime,
    val invitationStatus: String,
    val self: Boolean,
)

/** 10행 번호 페이징을 위한 회원 응답. */
data class MemberPageResponse(val items: List<MemberResponse>, val totalElements: Long, val page: Int, val size: Int)

/** 원문 토큰을 일반 객체 문자열에서 숨기는 초대 확인 입력. */
class InspectInvitationRequest(val token: String) {
    /** @return 비밀값을 제거한 로그 문자열. */
    override fun toString(): String = "InspectInvitationRequest(redacted)"
}

/** 원문 토큰과 비밀번호를 일반 객체 문자열에서 숨기는 설정 입력. */
class CompleteInvitationRequest(val token: String, val password: String) {
    /** @return 비밀값을 제거한 로그 문자열. */
    override fun toString(): String = "CompleteInvitationRequest(redacted)"
}

/** 유효한 일회용 초대의 대상과 만료 시각. */
data class InvitationResponse(val email: String, val name: String, val expiresAt: LocalDateTime)
