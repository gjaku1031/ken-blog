package io.github.gjaku1031.kenblog.member.service

import io.github.gjaku1031.kenblog.account.domain.UserEntity
import io.github.gjaku1031.kenblog.account.repository.AccountRepository
import io.github.gjaku1031.kenblog.member.domain.MemberInvitationEntity
import io.github.gjaku1031.kenblog.member.dto.CreateMemberRequest
import io.github.gjaku1031.kenblog.member.dto.InvitationResponse
import io.github.gjaku1031.kenblog.member.dto.MemberPageResponse
import io.github.gjaku1031.kenblog.member.dto.MemberResponse
import io.github.gjaku1031.kenblog.member.repository.MemberInvitationRepository
import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.Base64
import java.util.Locale
import java.util.UUID
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.data.repository.findByIdOrNull
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 관리자 발급, SMTP 초대, 일회용 비밀번호 설정, 계정·세션 폐기를 관리. */
@Service
class MemberService(
    private val accounts: AccountRepository,
    private val invitations: MemberInvitationRepository,
    private val mailer: InvitationMailer,
    private val encoder: PasswordEncoder,
    private val jdbc: JdbcTemplate,
) {
    /** @return [MemberPageResponse]에 현재 세션 본인 행을 표시한 발급 시각 내림차순 목록. */
    @Transactional(readOnly = true)
    fun list(page: Int, size: Int, currentUsername: String): MemberPageResponse {
        if (page < 0 || size !in 1..100) badInput()
        val result = accounts.findAll(PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt", "id")))
        return MemberPageResponse(result.content.map { it.response(currentUsername) }, result.totalElements, page, size)
    }

    /**
     * SMTP 설정을 먼저 확인하고 비활성 계정과 72시간 초대를 생성한 뒤 실제 발송.
     *
     * 전송 실패 시 트랜잭션을 롤백하므로 발급 완료로 표시하지 않음.
     */
    @Transactional
    fun create(request: CreateMemberRequest): MemberResponse {
        val name = request.name.trim()
        val email = request.email.trim().lowercase(Locale.ROOT)
        if (name.isBlank() || name.length > 100 || name.any(Char::isISOControl) ||
            email.length > 254 || !EMAIL.matches(email)) badInput()
        mailer.requireConfigured()
        if (accounts.findByEmail(email) != null) duplicate()
        val token = newToken()
        val account = try {
            accounts.saveAndFlush(UserEntity("member_${UUID.randomUUID().toString().replace("-", "")}",
                name, email, request.role, now()))
        } catch (_: DataIntegrityViolationException) {
            duplicate()
        }
        val invite = invitations.saveAndFlush(MemberInvitationEntity(account.id ?: error("Persisted member has no ID"), hash(token), now()))
        mailer.send(email, name, token)
        invite.markSent(now())
        invitations.saveAndFlush(invite)
        return account.response()
    }

    /** @return 유효하고 아직 사용하지 않은 초대의 대상·만료 시각. */
    @Transactional(readOnly = true)
    fun inspect(token: String): InvitationResponse {
        val invite = invitations.findByTokenHash(tokenHash(token)) ?: invalidToken()
        checkInvite(invite)
        val account = accounts.findByIdOrNull(invite.userId) ?: invalidToken()
        if (account.enabled) invalidToken()
        return InvitationResponse(account.email ?: invalidToken(), account.displayName ?: account.username, invite.expiresAt)
    }

    /** 원문 비밀번호를 BCrypt로 해시하고 잠긴 초대를 한 번만 소비. */
    @Transactional
    fun complete(token: String, password: String) {
        val bytes = password.toByteArray(Charsets.UTF_8)
        if (password.length < 12 || bytes.size > 72 || password.any(Char::isISOControl)) badInput()
        val invite = invitations.findLockedByTokenHash(tokenHash(token)) ?: invalidToken()
        checkInvite(invite)
        val account = accounts.findByIdOrNull(invite.userId) ?: invalidToken()
        if (account.enabled) invalidToken()
        account.activate(encoder.encode(password)
            ?: throw OperationFailure(HttpStatus.SERVICE_UNAVAILABLE, "비밀번호를 설정하지 못했습니다."))
        invite.consume(now())
        accounts.saveAndFlush(account)
        invitations.saveAndFlush(invite)
    }

    /**
     * 자기 계정 삭제를 막고 첨부의 작성자 FK를 현재 관리자에게 옮긴 뒤 모든 JDBC 세션을 폐기.
     *
     * 같은 트랜잭션에서 회원·초대 행을 삭제하며 기존 요청은 세션 재검사 필터가 거부.
     */
    @Transactional
    fun delete(id: Long, currentUsername: String) {
        val current = accounts.findByUsername(currentUsername)
            ?: throw OperationFailure(HttpStatus.UNAUTHORIZED, "인증이 필요합니다.")
        val target = (if (id > 0) accounts.findByIdOrNull(id) else null)
            ?: throw OperationFailure(HttpStatus.NOT_FOUND, "회원을 찾을 수 없습니다.")
        if (target.id == current.id) throw OperationFailure(HttpStatus.CONFLICT, "본인 계정은 삭제할 수 없습니다.")
        jdbc.update("UPDATE attachments SET uploaded_by = ? WHERE uploaded_by = ?", current.id, target.id)
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME = ?", target.username)
        invitations.findByUserId(id)?.let {
            invitations.delete(it)
            invitations.flush()
        }
        accounts.delete(target)
        accounts.flush()
    }

    /** @return 현재 세션과 같은 [UserEntity]만 본인으로 표시하고 비밀값을 제외한 행. */
    private fun UserEntity.response(currentUsername: String? = null): MemberResponse {
        val userId = id ?: error("Persisted member has no ID")
        val invitation = invitations.findByUserId(userId)
        val state = if (enabled) "ACTIVE" else if (invitation?.sentAt != null) "SENT" else "PENDING"
        return MemberResponse(userId, displayName ?: username, email ?: "", role, createdAt, state,
            currentUsername != null && username == currentUsername)
    }

    /** 유효 기간과 일회용 소비 상태를 확인. */
    private fun checkInvite(invite: MemberInvitationEntity) {
        if (invite.sentAt == null || invite.consumedAt != null || !invite.expiresAt.isAfter(now())) invalidToken()
    }

    /** @return 32바이트 난수의 URL 안전 원문 토큰. */
    private fun newToken(): String = ByteArray(32).also(random::nextBytes).let {
        Base64.getUrlEncoder().withoutPadding().encodeToString(it)
    }

    /** @return 형식을 확인한 원문 토큰의 SHA-256 해시. */
    private fun tokenHash(token: String): String {
        if (!TOKEN.matches(token)) invalidToken()
        return hash(token)
    }

    /** @return DB에만 보관할 소문자 hex SHA-256. */
    private fun hash(token: String): String = MessageDigest.getInstance("SHA-256")
        .digest(token.toByteArray(Charsets.US_ASCII)).joinToString("") { "%02x".format(it) }

    /** @return 현재 UTC DB 시각. */
    private fun now(): LocalDateTime = LocalDateTime.now(ZoneOffset.UTC)

    /** @return 회원 필드의 안전한 400. */
    private fun badInput(): Nothing = throw OperationFailure(HttpStatus.BAD_REQUEST, "회원 입력을 확인하세요.")

    /** @return 중복 이메일의 안전한 409. */
    private fun duplicate(): Nothing = throw OperationFailure(HttpStatus.CONFLICT, "이미 등록된 이메일입니다.")

    /** @return 잘못되거나 만료된 토큰의 안전한 410. */
    private fun invalidToken(): Nothing = throw OperationFailure(HttpStatus.GONE, "초대 링크가 만료됐거나 사용할 수 없습니다.")

    private companion object {
        val random = SecureRandom()
        val EMAIL = Regex("[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+")
        val TOKEN = Regex("[A-Za-z0-9_-]{43}")
    }
}
