package io.github.gjaku1031.kenblog.mcp.tool

import io.github.gjaku1031.kenblog.attachment.service.AttachmentService
import io.github.gjaku1031.kenblog.mcp.dto.McpImageInput
import io.github.gjaku1031.kenblog.mcp.dto.McpStackBadgeInput
import io.github.gjaku1031.kenblog.mcp.service.McpImagePayload
import io.github.gjaku1031.kenblog.mcp.service.McpToolCalls
import io.github.gjaku1031.kenblog.global.error.BusinessException
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component

/** 기존 로컬 저장소 첨부·기술 로고 서비스를 인라인 이미지 입력의 MCP 도구로 노출. */
@Component
class McpAssetTools(
    private val attachments: AttachmentService,
    private val badges: StackBadgeService,
    private val calls: McpToolCalls,
    @Value("\${app.auth.admin.username:}") private val adminUsername: String,
) {
    /** @return READY 첨부 ID와 파일 메타데이터를 가진 [AttachmentService.upload] 결과. */
    @McpTool(name = "blog_upload_image", description = "PNG/JPEG 이미지를 Base64로 로컬 저장소에 업로드하고 READY attachmentId를 반환합니다. 최대 10 MiB. 서버 파일 경로나 URL을 받지 않습니다. 본문 이미지 참조 뒤 blog_set_post_attachments 도구로 게시글 메타데이터에도 ID를 연결하세요.", annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun uploadImage(@McpToolParam(description = "파일명, image/png 또는 image/jpeg MIME, 순수 Base64 문자열") image: McpImageInput) = calls.call {
        if (adminUsername.isBlank()) throw BusinessException(HttpStatus.SERVICE_UNAVAILABLE, "업로드 계정을 확인할 수 없습니다.")
        attachments.upload(McpImagePayload.decode(image), adminUsername)
    }

    /** @return 정규화된 64px PNG 로고가 연결된 [StackBadgeService.create] 결과. */
    @McpTool(name = "blog_create_stack_badge", description = "기술 스택 이름과 PNG/JPEG Base64 로고를 등록합니다. 로고는 로컬 저장소에 64×64 PNG로 저장됩니다. 프로젝트 HOME의 stackBadgeNames에서 이 이름을 사용하세요.", annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun createStackBadge(@McpToolParam(description = "기술 이름과 10 MiB 이하 이미지") input: McpStackBadgeInput) =
        calls.call { badges.create(input.name, McpImagePayload.decode(input.image)) }

    /** 기존 프로젝트 연결을 유지한 채 [StackBadgeService.rename] 실행. */
    @McpTool(name = "blog_rename_stack_badge", description = "기술 뱃지 ID의 표시 이름을 바꿉니다. 기존 프로젝트와 로고 연결은 유지됩니다.", annotations = McpTool.McpAnnotations(openWorldHint = false))
    fun renameStackBadge(@McpToolParam(description = "양수 기술 뱃지 ID") badgeId: Long,
        @McpToolParam(description = "새 표시 이름") name: String) =
        calls.call { badges.rename(badgeId, name) }

    /** 기존 ID와 프로젝트 연결을 유지하며 [StackBadgeService.replaceImage] 실행. */
    @McpTool(name = "blog_replace_stack_badge_logo", description = "기술 뱃지 ID의 로고만 새 PNG/JPEG Base64 이미지로 교체합니다. ID와 프로젝트 연결은 유지됩니다. 기존 로고는 DB 커밋 후 정리됩니다.", annotations = McpTool.McpAnnotations(openWorldHint = false))
    fun replaceStackBadgeLogo(@McpToolParam(description = "양수 기술 뱃지 ID") badgeId: Long,
        @McpToolParam(description = "파일명, MIME, 순수 Base64 문자열") image: McpImageInput) =
        calls.call { badges.replaceImage(badgeId, McpImagePayload.decode(image)) }
}
