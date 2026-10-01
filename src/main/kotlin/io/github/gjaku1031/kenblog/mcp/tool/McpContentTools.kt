package io.github.gjaku1031.kenblog.mcp.tool

import io.github.gjaku1031.kenblog.mcp.dto.McpPostMetadataInput
import io.github.gjaku1031.kenblog.mcp.service.McpToolCalls
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest
import io.github.gjaku1031.kenblog.post.service.ContentFeedService
import io.github.gjaku1031.kenblog.post.service.PostService
import io.github.gjaku1031.kenblog.post.service.WikiLinkService
import io.github.gjaku1031.kenblog.project.domain.ProjectMetadata
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.stereotype.Component

/** Git 원고 경로를 반환하는 본문 없는 등록 결과. */
data class McpRegisteredPostResult(val post: PostDetailResponse, val sourcePath: String)

/** VM 내부 MCP의 글 조회와 DB 메타데이터 도구. Markdown 내용은 파일에서 직접 작성한다. */
@Component
class McpContentTools(
    private val posts: PostService,
    private val feed: ContentFeedService,
    private val wikiLinks: WikiLinkService,
    private val calls: McpToolCalls,
) {
    @McpTool(name = "blog_list_posts", description = "출간·미출간 글의 본문 없는 메타데이터를 조회합니다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun listPosts(@McpToolParam(description = "0부터 시작하는 페이지") page: Int,
        @McpToolParam(description = "1~100개의 페이지 크기") size: Int) =
        calls.call { posts.listDrafts(page, size) }

    @McpTool(name = "blog_get_post", description = "DB 메타데이터와 저장소 Markdown을 조회합니다. 파일이 없으면 원본 경로를 포함한 오류를 반환합니다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun getPost(@McpToolParam(description = "양수 게시글 ID") postId: Long) =
        calls.call { posts.adminDetail(postId) }

    @McpTool(name = "blog_search_posts", description = "공개 출간 글의 제목·원고·태그·분류를 검색합니다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun searchPosts(@McpToolParam(description = "1~100자의 검색어") query: String,
        @McpToolParam(description = "0부터 시작하는 페이지") page: Int,
        @McpToolParam(description = "1~100개의 페이지 크기") size: Int) =
        calls.call { feed.search(query, page, size, null) }

    @McpTool(name = "blog_resolve_wiki_targets", description = "위키 대상 제목이 현재 공개 글을 가리키는지 확인합니다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun resolveWikiTargets(@McpToolParam(description = "확인할 제목 1~20개") titles: List<String>) = calls.call {
        val query = titles.joinToString("&") { "title=" + URLEncoder.encode(it, StandardCharsets.UTF_8) }
        wikiLinks.resolve(titles, query, null)
    }

    @McpTool(name = "blog_register_post", description = "본문 없이 글 메타데이터와 slug를 등록합니다. 반환한 content/posts/{slug}.md를 저장소에서 직접 작성하고 Git에 커밋하세요.",
        annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun registerPost(@McpToolParam(description = "제목·slug·섹션·부모·첨부/위키 선언; body 필드 없음") input: McpPostMetadataInput) = calls.call {
        val metadata = input.projectMetadata?.let { ProjectMetadata(it.status, it.startPeriod, it.endPeriod,
            it.overview, PostVisibility.PUBLIC, null, it.stackBadgeNames) }
        val created = posts.createMetadata(PostMetadataCreateRequest(input.title, input.slug, input.section,
            input.summary, input.categoryId, input.tags, input.projectId, input.relatedProjectId,
            input.courseId, input.documentOrder, input.chapterOrder, input.techSeriesOrder, metadata,
            input.attachmentIds, input.wikiTargets))
        McpRegisteredPostResult(created, "content/posts/${created.slug}.md")
    }

    @McpTool(name = "blog_update_post_metadata", description = "원고를 바꾸지 않고 글의 제목·요약·분류·태그를 갱신합니다.",
        annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun updatePostMetadata(@McpToolParam(description = "양수 게시글 ID") postId: Long,
        @McpToolParam(description = "제목") title: String,
        @McpToolParam(description = "120자 이하 요약") summary: String,
        @McpToolParam(description = "분류 ID 또는 null", required = false) categoryId: Long?,
        @McpToolParam(description = "태그 전체 목록") tags: List<String>) =
        calls.call { posts.updateMetadata(postId, title, summary, categoryId, tags) }

    @McpTool(name = "blog_set_post_attachments", description = "원고의 attachment:ID 이미지가 공개 전달되도록 연결 ID 전체를 지정합니다.",
        annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun setPostAttachments(@McpToolParam(description = "양수 게시글 ID") postId: Long,
        @McpToolParam(description = "READY 첨부 ID 전체 목록") attachmentIds: List<Long>) =
        calls.call { posts.replaceAttachments(postId, attachmentIds) }

    @McpTool(name = "blog_set_post_wiki_targets", description = "현재 원고 SHA-256을 확인하고 위키 대상 제목 선언 전체를 교체합니다.",
        annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun setPostWikiTargets(@McpToolParam(description = "양수 게시글 ID") postId: Long,
        @McpToolParam(description = "blog_get_post의 bodySha256") expectedBodySha256: String,
        @McpToolParam(description = "위키 대상 제목 전체 목록") wikiTargets: List<String>) =
        calls.call { posts.replaceWikiLinks(postId, expectedBodySha256, wikiTargets) }

    @McpTool(name = "blog_set_post_publication", description = "원고 파일을 수정하지 않고 게시글의 공개 출간 상태만 명시적으로 바꿉니다. Git 원고가 먼저 있어야 Pages 빌드가 성공합니다.",
        annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun setPostPublication(@McpToolParam(description = "양수 게시글 ID") postId: Long,
        @McpToolParam(description = "true=공개 출간, false=미출간") published: Boolean) =
        calls.call { posts.setPublished(postId, published) }
}
