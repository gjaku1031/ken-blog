package io.github.gjaku1031.kenblog.mcp.tool

import io.github.gjaku1031.kenblog.category.service.CategoryService
import io.github.gjaku1031.kenblog.series.dto.*
import io.github.gjaku1031.kenblog.series.service.SeriesService
import io.github.gjaku1031.kenblog.mcp.service.McpToolCalls
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.stereotype.Component

/** 분류·시리즈·기술 스택 카탈로그의 단위 작업 도구. */
@Component
class McpCatalogTools(
    private val categories: CategoryService,
    private val series: SeriesService,
    private val badges: StackBadgeService,
    private val calls: McpToolCalls,
) {
    /** @return 비어 있는 폴더까지 포함한 [CategoryService.tree] 관리자 분류. */
    @McpTool(name = "blog_list_categories", description = "글에 사용할 분류 트리, ID, 경로 및 글 수를 조회합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun listCategories() = calls.call { categories.tree(true, null) }

    /** [CategoryService.create]가 중간 경로를 재사용하고 마지막 분류를 생성. */
    @McpTool(name = "blog_create_category", description = "슬래시 구분 1~3단계 글 분류를 만듭니다. 예: Backend/Kotlin/Spring.", annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun createCategory(@McpToolParam(description = "슬래시 구분 1~3단계 분류 경로") path: String) =
        calls.call { categories.create(path) }

    /** [CategoryService.setOrder]로 기존 분류 하나의 숫자 순서 지정. */
    @McpTool(name = "blog_set_category_order", description = "분류 ID의 형제 내 표시 순서를 숫자로 지정합니다. 동률은 ID순입니다.", annotations = McpTool.McpAnnotations(openWorldHint = false))
    fun setCategoryOrder(@McpToolParam(description = "양수 분류 ID") categoryId: Long,
        @McpToolParam(description = "부호 있는 32비트 정수 순서") order: Long) =
        calls.call { categories.setOrder(categoryId, order) }

    @McpTool(name = "blog_list_series", description = "일반·프로젝트 시리즈와 첫 공개 글을 조회합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun listSeries() = calls.call { series.list(true) }

    @McpTool(name = "blog_get_series", description = "시리즈 메타데이터와 초안을 포함한 문서 목록을 조회합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun getSeries(@McpToolParam(description = "시리즈 ID") id: Long) = calls.call { series.detail(id, true) }

    @McpTool(name = "blog_create_series", description = "TECH 또는 PROJECT 시리즈를 생성합니다. 기술 스택과 기간은 PROJECT만 허용합니다.", annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun createSeries(@McpToolParam(description = "slug·kind·metadata") input: SeriesCreateRequest) = calls.call { series.create(input) }

    @McpTool(name = "blog_update_series", description = "조회한 baseUpdatedAt을 확인하고 시리즈 메타데이터를 교체합니다.", annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun updateSeries(@McpToolParam(description = "시리즈 ID") id: Long,
        @McpToolParam(description = "변경할 메타데이터와 baseUpdatedAt") input: SeriesMetadataRequest) = calls.call { series.update(id, input) }

    /** @return 사용 프로젝트 수와 실제 로고 URL을 포함한 [StackBadgeService.listAdmin]. */
    @McpTool(name = "blog_list_stack_badges", description = "등록된 기술 스택 이름·ID·로고 URL·사용 프로젝트 수를 조회합니다. 새 로고 등록·교체는 별도 도구를 사용합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun listStackBadges() = calls.call { badges.listAdmin() }

}
