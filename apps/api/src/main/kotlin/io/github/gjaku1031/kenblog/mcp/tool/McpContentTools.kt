package io.github.gjaku1031.kenblog.mcp.tool

import io.github.gjaku1031.kenblog.draft.domain.InvalidEditorDraftRequestException
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftCreateRequest
import io.github.gjaku1031.kenblog.draft.dto.EditorDraftUpdateRequest
import io.github.gjaku1031.kenblog.draft.service.EditorDraftService
import io.github.gjaku1031.kenblog.mcp.authoring.McpBodyDeclarations
import io.github.gjaku1031.kenblog.mcp.dto.McpDraftInput
import io.github.gjaku1031.kenblog.mcp.dto.McpDraftUpdateInput
import io.github.gjaku1031.kenblog.mcp.dto.McpDraftWriteResult
import io.github.gjaku1031.kenblog.mcp.service.McpToolCalls
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.TagNames
import io.github.gjaku1031.kenblog.post.dto.WikiDeclarations
import io.github.gjaku1031.kenblog.post.service.ContentFeedService
import io.github.gjaku1031.kenblog.post.service.PostService
import io.github.gjaku1031.kenblog.post.service.WikiLinkService
import io.github.gjaku1031.kenblog.project.domain.ProjectMetadata
import io.github.gjaku1031.kenblog.project.dto.ProjectMetadataRequests
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.LocalDateTime
import java.time.format.DateTimeParseException
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.stereotype.Component

/** VM 내부 MCP의 글·편집본 도구를 기존 트랜잭션 서비스에 연결. */
@Component
class McpContentTools(
    private val posts: PostService,
    private val drafts: EditorDraftService,
    private val feed: ContentFeedService,
    private val wikiLinks: WikiLinkService,
    private val declarations: McpBodyDeclarations,
    private val calls: McpToolCalls,
) {
    /** @return 비출간 글을 포함한 관리자 목록 [PostService.listDrafts]. */
    @McpTool(name = "blog_list_posts", description = "Tech, Projects, Notes의 출간/비출간 원본 글을 본문 없이 페이지로 조회합니다. page는 0부터, size는 1~100입니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun listPosts(@McpToolParam(description = "0부터 시작하는 페이지") page: Int,
        @McpToolParam(description = "1~100개의 페이지 크기") size: Int) =
        calls.call { posts.listDrafts(page, size) }

    /** @return 본문·분류·태그·첨부·위키 선언을 포함한 [PostService.adminDetail] 결과. */
    @McpTool(name = "blog_get_post", description = "원본 글 ID의 전체 내용과 updatedAt, section, 소속, 첨부/위키 선언을 조회합니다. 기존 글 편집본 생성 전에 호출하세요.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun getPost(@McpToolParam(description = "양수 원본 글 ID") postId: Long) =
        calls.call { posts.adminDetail(postId) }

    /** @return 관리자 비공개 글도 포함한 출간 콘텐츠 검색 [ContentFeedService.search] 결과. */
    @McpTool(name = "blog_search_posts", description = "출간 글의 제목·본문·태그·분류를 검색합니다. 비공개 출간 글도 VM 관리자 도구에서 검색합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun searchPosts(@McpToolParam(description = "1~100자의 검색어") query: String,
        @McpToolParam(description = "0부터 시작하는 페이지") page: Int,
        @McpToolParam(description = "1~100개의 페이지 크기") size: Int) =
        calls.call { feed.search(query, page, size, LOCAL_ADMIN) }

    /** [WikiLinkService.resolve]로 대상 제목이 어느 출간 글을 가리키는지 확인. */
    @McpTool(name = "blog_resolve_wiki_targets", description = "최대 20개의 위키 대상 제목을 현재 출간 글과 대조합니다. 작성 전 제목 충돌·없는 대상을 확인하세요.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun resolveWikiTargets(@McpToolParam(description = "본문 [[제목]]에서 참조할 제목 1~20개") titles: List<String>) = calls.call {
        val query = titles.joinToString("&") { "title=" + URLEncoder.encode(it, StandardCharsets.UTF_8) }
        wikiLinks.resolve(titles, query, LOCAL_ADMIN)
    }

    /** @return 저장 중인 편집본과 revision을 본문 없이 조회한 [EditorDraftService.list] 결과. */
    @McpTool(name = "blog_list_drafts", description = "편집본을 수정 시각 역순으로 조회합니다. postId를 주면 해당 원본의 편집본만 조회합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun listDrafts(@McpToolParam(description = "0부터 시작하는 페이지") page: Int,
        @McpToolParam(description = "1~100개의 페이지 크기") size: Int,
        @McpToolParam(description = "선택적 원본 글 ID", required = false) postId: Long?) =
        calls.call { drafts.list(page, size, postId) }

    /** @return 현재 revision과 본문·선언을 포함한 [EditorDraftService.detail] 결과. */
    @McpTool(name = "blog_get_draft", description = "편집본 ID로 현재 revision과 전체 원고, 별도 첨부/위키 선언을 조회합니다. 수정이나 발행 전에 호출하세요.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun getDraft(@McpToolParam(description = "양수 편집본 ID") draftId: Long) =
        calls.call { drafts.detail(draftId) }

    /**
     * 모든 섹션의 새 원고 또는 기존 글 편집본을 [EditorDraftService.create]로 저장.
     * 기존 글은 [McpDraftInput.postId]와 원본 updatedAt을 함께 지정해야 함.
     */
    @McpTool(name = "blog_create_draft", description = "TECH/PROJECT_HOME/PROJECT_DOC/NOTE_CHAPTER 편집본을 만듭니다. attachmentIds와 wikiTargets는 본문에 쓴 참조의 전체 배열입니다. 기존 글 수정은 blog_get_post의 postId와 baseUpdatedAt 및 기존 소속을 지정하세요. 발행은 별도 blog_publish_draft입니다.", annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun createDraft(@McpToolParam(description = "전체 원고, 섹션, 소속, 명시적 본문 선언 및 선택적 원본 기준 시각") input: McpDraftInput) = calls.call {
        val inspection = declarations.validate(input.body, input.attachmentIds, input.wikiTargets)
        val prepared = prepare(input)
        val saved = drafts.create(EditorDraftCreateRequest(input.postId, parseTime(input.baseUpdatedAt),
            input.title, input.body, input.categoryId, prepared.tags, input.visibility,
            prepared.attachmentIds, prepared.wikiTargets, input.section, input.projectId,
            input.relatedProjectId, input.documentOrder, prepared.metadata, input.courseId, input.chapterOrder,
            input.summary, input.techSeriesOrder))
        McpDraftWriteResult(saved, inspection.diagnostics)
    }

    /** [EditorDraftService.update]의 revision 충돌 검사를 유지하며 전체 내용을 교체. */
    @McpTool(name = "blog_update_draft", description = "현재 revision의 편집본 원고 전체를 교체합니다. blog_get_draft의 섹션·소속과 attachmentIds/wikiTargets 전체 배열을 다시 보내세요. 원본 글은 발행 전까지 바뀌지 않습니다. content의 postId/baseUpdatedAt은 생략하세요.", annotations = McpTool.McpAnnotations(openWorldHint = false))
    fun updateDraft(@McpToolParam(description = "양수 편집본 ID") draftId: Long,
        @McpToolParam(description = "현재 revision과 전체 원고") input: McpDraftUpdateInput) = calls.call {
        val content = input.content
        if (content.postId != null || content.baseUpdatedAt != null) throw InvalidEditorDraftRequestException()
        val inspection = declarations.validate(content.body, content.attachmentIds, content.wikiTargets)
        val prepared = prepare(content)
        val saved = drafts.update(draftId, EditorDraftUpdateRequest(input.revision, content.title,
            content.body, content.categoryId, prepared.tags, content.visibility, prepared.attachmentIds,
            prepared.wikiTargets, content.section, content.projectId, content.relatedProjectId,
            content.documentOrder, prepared.metadata, content.courseId, content.chapterOrder,
            content.summary, content.techSeriesOrder))
        McpDraftWriteResult(saved, inspection.diagnostics)
    }

    /** 현재 revision의 편집본을 원자적으로 출간하고 [PostService.adminDetail]을 반환. */
    @McpTool(name = "blog_publish_draft", description = "편집본 ID와 현재 revision이 일치할 때만 원본 글로 원자적으로 발행합니다. 새 프로젝트 HOME은 프로젝트도 함께 생성합니다. 최신 blog_get_draft 후 호출하세요.", annotations = McpTool.McpAnnotations(openWorldHint = false))
    fun publishDraft(@McpToolParam(description = "양수 편집본 ID") draftId: Long,
        @McpToolParam(description = "조회한 현재 revision") revision: Long) =
        calls.call { drafts.publish(draftId, revision) }

    /** 원본 글은 유지하고 명시 revision의 편집본만 [EditorDraftService.delete]로 삭제. */
    @McpTool(name = "blog_delete_draft", description = "지정한 편집본만 삭제합니다. 원본 출간 글은 유지됩니다. ID와 현재 revision을 명시해야 합니다.", annotations = McpTool.McpAnnotations(openWorldHint = false))
    fun deleteDraft(@McpToolParam(description = "삭제할 양수 편집본 ID") draftId: Long,
        @McpToolParam(description = "조회한 현재 revision") revision: Long) = calls.call {
        drafts.delete(draftId, revision)
        mapOf("deletedDraftId" to draftId)
    }

    /** 기존 관리자 JSON 입력의 길이·ID·태그 검증을 MCP 입력에도 적용. */
    private fun prepare(input: McpDraftInput): Prepared {
        if (input.title.codePointCount(0, input.title.length) > 200 ||
            input.body.toByteArray(Charsets.UTF_8).size > 1024 * 1024 ||
            input.summary.codePointCount(0, input.summary.length) > 120 ||
            listOf(input.categoryId, input.projectId, input.relatedProjectId, input.courseId, input.postId)
                .any { it != null && it <= 0 } ||
            input.techSeriesOrder?.let { it <= 0 } == true ||
            input.documentOrder?.let { it <= 0 } == true ||
            input.chapterOrder?.let { it <= 0 } == true ||
            (input.postId == null) != (input.baseUpdatedAt == null) ||
            input.attachmentIds.size > 100 || input.attachmentIds.any { it <= 0 })
            throw InvalidEditorDraftRequestException()
        val tags = try { TagNames.displayAll(input.tags) }
            catch (_: InvalidPostRequestException) { throw InvalidEditorDraftRequestException() }
        val wiki = WikiDeclarations.normalized(input.wikiTargets)
        val metadata = input.projectMetadata?.let { value ->
            ProjectMetadataRequests.validate(ProjectMetadata(value.status, value.startPeriod, value.endPeriod,
                value.overview, input.visibility, parseTime(value.baseProjectUpdatedAt), value.stackBadgeNames))
        }
        return Prepared(tags, input.attachmentIds.distinct().sorted(), wiki, metadata)
    }

    /** @return 비어 있는 선택 시각 또는 엄격한 ISO-8601 UTC DB 시각. */
    private fun parseTime(raw: String?): LocalDateTime? = raw?.let {
        try { LocalDateTime.parse(it) } catch (_: DateTimeParseException) { throw InvalidEditorDraftRequestException() }
    }

    /** 검증된 태그·선언·프로젝트 메타를 기존 서비스 DTO에 공급. */
    private data class Prepared(val tags: List<String>, val attachmentIds: List<Long>,
        val wikiTargets: List<String>, val metadata: ProjectMetadata?)

    private companion object {
        /** VM 한정 도구에서 출간 비공개 글 조회에 쓰는 내부 관리자 역할. */
        val LOCAL_ADMIN = UsernamePasswordAuthenticationToken("mcp-local", null,
            listOf(SimpleGrantedAuthority("ROLE_ADMIN")))
    }
}
