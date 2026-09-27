package io.github.gjaku1031.kenblog.member.service

import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import java.net.URI
import java.util.Properties
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.mail.MailException
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSenderImpl
import org.springframework.stereotype.Service

/** 외부 SMTP가 완전히 설정된 경우에만 일회용 링크를 실제 발송. */
@Service
class InvitationMailer(
    @Value("\${app.invitation.web-base-url:}") private val webBaseUrl: String,
    @Value("\${app.invitation.from:}") private val from: String,
    @Value("\${app.invitation.smtp.host:}") private val host: String,
    @Value("\${app.invitation.smtp.port:587}") private val port: Int,
    @Value("\${app.invitation.smtp.username:}") private val username: String,
    @Value("\${app.invitation.smtp.password:}") private val password: String,
) {
    /**
     * 설정 누락을 발급 전에 거부하고 STARTTLS 인증 SMTP로 초대 링크를 전송.
     *
     * @throws OperationFailure 미설정 또는 발송 실패 시 503
     */
    fun send(email: String, name: String, token: String) {
        requireConfigured()
        val sender = JavaMailSenderImpl().apply {
            this.host = this@InvitationMailer.host
            this.port = this@InvitationMailer.port
            this.username = this@InvitationMailer.username
            this.password = this@InvitationMailer.password
            javaMailProperties = Properties().apply {
                put("mail.smtp.auth", "true")
                put("mail.smtp.starttls.enable", "true")
                put("mail.smtp.starttls.required", "true")
                put("mail.smtp.connectiontimeout", "5000")
                put("mail.smtp.timeout", "5000")
                put("mail.smtp.writetimeout", "5000")
            }
        }
        val message = SimpleMailMessage().apply {
            setFrom(this@InvitationMailer.from)
            setTo(email)
            subject = "ken.blog 계정 초대"
            text = "${name}님, 아래 링크에서 72시간 안에 비밀번호를 설정해 주세요.\n\n${webBaseUrl.trimEnd('/')}/invite/?token=$token\n"
        }
        try {
            sender.send(message)
        } catch (_: MailException) {
            throw OperationFailure(HttpStatus.SERVICE_UNAVAILABLE, "초대 메일을 보내지 못했습니다.")
        }
    }

    /** @throws OperationFailure 안전한 발송 조건을 충족하지 못할 때 */
    fun requireConfigured() {
        val uri = runCatching { URI(webBaseUrl) }.getOrNull()
        if (host.isBlank() || from.isBlank() || username.isBlank() || password.isBlank() || port !in 1..65535 ||
            uri == null || uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null ||
            uri.query != null || uri.fragment != null || !from.contains('@')) {
            throw OperationFailure(HttpStatus.SERVICE_UNAVAILABLE, "초대 메일이 설정되지 않았습니다.")
        }
    }
}
