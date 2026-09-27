package io.github.gjaku1031.kenblog.member.controller

import io.github.gjaku1031.kenblog.member.dto.CompleteInvitationRequest
import io.github.gjaku1031.kenblog.member.dto.CreateMemberRequest
import io.github.gjaku1031.kenblog.member.dto.InspectInvitationRequest
import io.github.gjaku1031.kenblog.member.dto.InvitationResponse
import io.github.gjaku1031.kenblog.member.dto.MemberPageResponse
import io.github.gjaku1031.kenblog.member.dto.MemberResponse
import io.github.gjaku1031.kenblog.member.service.MemberService
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** 관리자 회원 목록·발급·삭제와 공개 일회용 초대 소비를 [MemberService]에 연결. */
@RestController
class MemberController(private val service: MemberService) : MemberApi {
    /** @return [MemberPageResponse]에 본인 여부를 넣은 페이지별 회원 행과 총 수. */
    @GetMapping("/api/v1/admin/members")
    override fun list(@RequestParam(defaultValue = "0") page: Int, @RequestParam(defaultValue = "10") size: Int,
                      authentication: Authentication): MemberPageResponse =
        service.list(page, size, authentication.name)

    /** @return 실제 초대 메일 발송을 마친 회원과 HTTP 201. */
    @PostMapping("/api/v1/admin/members")
    override fun create(@RequestBody body: CreateMemberRequest): ResponseEntity<MemberResponse> =
        ResponseEntity.status(201).body(service.create(body))

    /** @return 삭제와 세션 폐기를 마친 HTTP 204. */
    @DeleteMapping("/api/v1/admin/members/{id}")
    override fun delete(@PathVariable id: Long, authentication: Authentication): ResponseEntity<Void> {
        service.delete(id, authentication.name)
        return ResponseEntity.noContent().build()
    }

    /** @return 원문 토큰을 응답에서 제외한 초대 대상. */
    @PostMapping("/api/v1/auth/invitations/inspect")
    override fun inspect(@RequestBody body: InspectInvitationRequest): InvitationResponse = service.inspect(body.token)

    /** @return 비밀번호 설정과 토큰 폐기 후 HTTP 204. */
    @PostMapping("/api/v1/auth/invitations/complete")
    override fun complete(@RequestBody body: CompleteInvitationRequest): ResponseEntity<Void> {
        service.complete(body.token, body.password)
        return ResponseEntity.noContent().build()
    }
}
