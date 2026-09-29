package io.github.gjaku1031.kenblog.mcp.authoring

import io.modelcontextprotocol.spec.McpSchema.GetPromptResult
import io.modelcontextprotocol.spec.McpSchema.PromptMessage
import io.modelcontextprotocol.spec.McpSchema.Role
import io.modelcontextprotocol.spec.McpSchema.TextContent
import org.springframework.ai.mcp.annotation.McpArg
import org.springframework.ai.mcp.annotation.McpPrompt
import org.springframework.ai.mcp.annotation.McpResource
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.stereotype.Component

/** 명시 선언과 확실한 후보의 비교 결과; null은 복잡 본문이라 판정 불가. */
data class McpDocumentValidation(
    val inspection: McpBodyInspection,
    val declarationsMatch: Boolean?,
    val declarationDiagnostics: List<String>,
)

/** 제품 스킬의 동일 원본을 MCP resource·tool·prompt에 제공. */
@Component
class McpAuthoringGuide(private val declarations: McpBodyDeclarations) {
    /** @return 스킬의 짧은 진입 문서. */
    @McpResource(uri = "kenblog://authoring/skill", name = "Ken Blog authoring skill",
        description = "Ken Blog MCP 글 작성 순서와 참조 문서 안내", mimeType = "text/markdown")
    fun skill(): String = read("SKILL.md")

    /** @return Tech·Projects·Notes와 편집본 데이터 관계. */
    @McpResource(uri = "kenblog://authoring/content-model", name = "Ken Blog content model",
        description = "섹션, 프로젝트, Notes, 뱃지의 저장 계약", mimeType = "text/markdown")
    fun contentModel(): String = read("references/content-model.md")

    /** @return 웹 렌더러에 맞춘 저장 Markdown 문법. */
    @McpResource(uri = "kenblog://authoring/markdown", name = "Ken Blog Markdown",
        description = "이미지, 표, 위키, 주석, KaTeX, Mermaid, 접기의 본문 원문", mimeType = "text/markdown")
    fun markdown(): String = read("references/markdown.md")

    /** @return 화면 단축키와 저장 문법의 차이. */
    @McpResource(uri = "kenblog://authoring/editor-shortcuts", name = "Ken Blog editor shortcuts",
        description = "CodeMirror 원문 편집과 자동 미리보기", mimeType = "text/markdown")
    fun shortcuts(): String = read("references/editor-shortcuts.md")

    /** resource 조회를 지원하지 않는 MCP 클라이언트에도 같은 파일을 제공. */
    @McpTool(name = "get_authoring_guide",
        description = "Ken Blog 글 작성 스킬과 섹션·Markdown·원문 편집 참조 문서를 읽습니다. 실제 저장 문법과 도구 호출 순서를 확인할 때 사용하세요.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun getAuthoringGuide(): String = listOf(skill(), contentModel(), markdown(), shortcuts()).joinToString("\n\n")

    /**
     * 단순 Markdown의 선언 일치와 복잡 문법의 검사 한계를 반환.
     * 전체 추출 불가일 때 [McpDocumentValidation.declarationsMatch]는 null.
     */
    @McpTool(name = "blog_validate_document",
        description = "본문과 명시 attachmentIds/wikiTargets를 저장 전에 점검합니다. complete=false의 후보 목록은 부분 목록이며 선언 자동 추출에 사용하면 안 됩니다.",
        annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun validateDocument(
        @McpToolParam(description = "저장할 Markdown 본문") body: String,
        @McpToolParam(description = "실제로 표시되는 READY 첨부 ID의 전체 배열") attachmentIds: List<Long>,
        @McpToolParam(description = "실제로 표시되는 위키 제목의 전체 배열") wikiTargets: List<String>,
    ): McpDocumentValidation {
        val inspection = declarations.inspect(body)
        val declarationDiagnostics = declarations.declarationDiagnostics(attachmentIds, wikiTargets)
        val matches = when {
            declarationDiagnostics.isNotEmpty() -> false
            inspection.complete -> inspection.candidateAttachmentIds == attachmentIds.sorted() &&
                inspection.candidateWikiTargets == wikiTargets
            else -> null
        }
        return McpDocumentValidation(inspection, matches, declarationDiagnostics)
    }

    /** 글감과 저장 위치를 받되 도구 실행은 요구하지 않는 작성 prompt. */
    @McpPrompt(name = "plan_ken_blog_article", description = "Ken Blog 섹션에 맞는 Markdown 원고와 저장 필드 계획")
    fun planArticle(
        @McpArg(name = "topic", description = "글의 주제", required = true) topic: String,
        @McpArg(name = "section", description = "TECH, PROJECT_HOME, PROJECT_DOC, NOTE_CHAPTER", required = true) section: String,
    ): GetPromptResult = GetPromptResult("Ken Blog 원고 계획", listOf(PromptMessage(Role.USER,
        TextContent("주제: $topic\n섹션: $section\nKen Blog 작성 스킬 kenblog://authoring/skill과 해당 참조를 읽고 " +
            "본문 구조·필요한 저장 메타데이터·첨부/위키 선언을 계획하세요. 출간은 사용자의 요청 범위에 맞추세요."))))

    /** @return 클래스패스의 단일 스킬 원본; 누락 시 서버 구성 오류. */
    private fun read(name: String): String = javaClass.classLoader
        .getResourceAsStream("mcp/ken-blog-authoring/$name")?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
        ?: error("Missing Ken Blog authoring resource: $name")
}
