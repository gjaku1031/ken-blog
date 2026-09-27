package io.github.gjaku1031.kenblog.member.controller

import io.github.gjaku1031.kenblog.member.dto.CompleteInvitationRequest
import io.github.gjaku1031.kenblog.member.dto.CreateMemberRequest
import io.github.gjaku1031.kenblog.member.dto.InspectInvitationRequest
import io.github.gjaku1031.kenblog.member.dto.InvitationResponse
import io.github.gjaku1031.kenblog.member.dto.MemberPageResponse
import io.github.gjaku1031.kenblog.member.dto.MemberResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam

/** 관리자 회원 관리와 일회용 초대의 HTTP/OpenAPI 계약. */
interface MemberApi {
    /** @return 본인 행이 표시된 [MemberPageResponse] 관리자 회원 페이지. */
    @GetMapping("/api/v1/admin/members")
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "회원 목록")
    fun list(@RequestParam(defaultValue = "0") page: Int, @RequestParam(defaultValue = "10") size: Int,
             authentication: Authentication): MemberPageResponse

    /** @return 메일이 실제 발송된 회원. */
    @PostMapping("/api/v1/admin/members")
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "회원 발급과 초대 메일 발송")
    @ApiResponses(value = [ApiResponse(responseCode = "201"), ApiResponse(responseCode = "400"), ApiResponse(responseCode = "409"), ApiResponse(responseCode = "503")])
    fun create(@RequestBody body: CreateMemberRequest): ResponseEntity<MemberResponse>

    /** @return 모든 세션을 폐기한 HTTP 204. */
    @DeleteMapping("/api/v1/admin/members/{id}")
    @SecurityRequirement(name = "sessionCookie")
    @Operation(summary = "회원 삭제")
    @ApiResponses(value = [ApiResponse(responseCode = "204"), ApiResponse(responseCode = "404"), ApiResponse(responseCode = "409")])
    fun delete(@PathVariable id: Long, authentication: Authentication): ResponseEntity<Void>

    /** @return 유효한 초대의 대상과 만료 시각. */
    @PostMapping("/api/v1/auth/invitations/inspect")
    @Operation(summary = "초대 링크 확인")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "410")])
    fun inspect(@RequestBody body: InspectInvitationRequest): InvitationResponse

    /** @return 암호화 비밀번호 설정 후 HTTP 204. */
    @PostMapping("/api/v1/auth/invitations/complete")
    @Operation(summary = "초대 비밀번호 설정")
    @ApiResponses(value = [ApiResponse(responseCode = "204"), ApiResponse(responseCode = "400"), ApiResponse(responseCode = "410")])
    fun complete(@RequestBody body: CompleteInvitationRequest): ResponseEntity<Void>
}
