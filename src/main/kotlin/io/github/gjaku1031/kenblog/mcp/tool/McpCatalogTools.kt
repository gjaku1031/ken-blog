package io.github.gjaku1031.kenblog.mcp.tool

import io.github.gjaku1031.kenblog.category.service.CategoryService
import io.github.gjaku1031.kenblog.mcp.dto.McpCourseInput
import io.github.gjaku1031.kenblog.mcp.service.McpToolCalls
import io.github.gjaku1031.kenblog.note.domain.InvalidCourseRequestException
import io.github.gjaku1031.kenblog.note.dto.CourseWriteRequest
import io.github.gjaku1031.kenblog.note.service.CourseService
import io.github.gjaku1031.kenblog.project.service.ProjectService
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.stereotype.Component

/** 분류·프로젝트·Notes 과목·기술 스택 카탈로그의 단위 작업 도구. */
@Component
class McpCatalogTools(
    private val categories: CategoryService,
    private val projects: ProjectService,
    private val courses: CourseService,
    private val badges: StackBadgeService,
    private val calls: McpToolCalls,
) {
    /** @return 비어 있는 폴더까지 포함한 [CategoryService.tree] 관리자 분류. */
    @McpTool(name = "blog_list_categories", description = "Tech와 프로젝트 문서에 사용할 분류 트리, ID, 경로 및 글 수를 조회합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun listCategories() = calls.call { categories.tree(true, null) }

    /** [CategoryService.create]가 중간 경로를 재사용하고 마지막 분류를 생성. */
    @McpTool(name = "blog_create_category", description = "슬래시 구분 1~3단계 Tech/프로젝트 문서 분류를 만듭니다. 예: Backend/Kotlin/Spring.", annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun createCategory(@McpToolParam(description = "슬래시 구분 1~3단계 분류 경로") path: String) =
        calls.call { categories.create(path) }

    /** [CategoryService.setOrder]로 기존 분류 하나의 숫자 순서 지정. */
    @McpTool(name = "blog_set_category_order", description = "분류 ID의 형제 내 표시 순서를 숫자로 지정합니다. 동률은 ID순입니다.", annotations = McpTool.McpAnnotations(openWorldHint = false))
    fun setCategoryOrder(@McpToolParam(description = "양수 분류 ID") categoryId: Long,
        @McpToolParam(description = "부호 있는 32비트 정수 순서") order: Long) =
        calls.call { categories.setOrder(categoryId, order) }

    /** @return 초안과 HOME 메타를 포함한 [ProjectService.adminList] 페이지. */
    @McpTool(name = "blog_list_projects", description = "프로젝트 목록을 본문 없이 조회합니다. 새 프로젝트는 blog_register_post의 PROJECT_HOME 메타데이터로 등록합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun listProjects(@McpToolParam(description = "0부터 시작하는 페이지") page: Int,
        @McpToolParam(description = "1~100개의 페이지 크기") size: Int) =
        calls.call { projects.adminList(page, size) }

    /** @return HOME과 문서·기술 로고를 포함한 [ProjectService.adminDetail]. */
    @McpTool(name = "blog_get_project", description = "프로젝트 ID로 HOME 원고, 문서 목록, 기술 스택 로고 및 프로젝트 수정 기준 시각을 조회합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun getProject(@McpToolParam(description = "양수 프로젝트 ID") projectId: Long) =
        calls.call { projects.adminDetail(projectId) }

    /** @return 초안 회차 수를 포함한 [CourseService.adminList]. */
    @McpTool(name = "blog_list_notes_courses", description = "Notes 과목과 출간 회차 수를 조회합니다. 회차는 blog_register_post의 NOTE_CHAPTER 메타데이터로 등록하고 Markdown은 Git에 작성합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun listNotesCourses() = calls.call { courses.adminList() }

    /** @return 과목 메타와 전체 회차를 포함한 [CourseService.adminDetail]. */
    @McpTool(name = "blog_get_notes_course", description = "과목 ID로 상태·분야·소개·전체 회차와 수정 시각을 조회합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun getNotesCourse(@McpToolParam(description = "양수 Notes 과목 ID") courseId: Long) =
        calls.call { courses.adminDetail(courseId) }

    /** 입력 경계 검증 후 [CourseService.create]로 과목을 생성. */
    @McpTool(name = "blog_create_notes_course", description = "Notes 과목을 만들고 새 ID를 반환합니다. 회차는 blog_register_post에서 section=NOTE_CHAPTER, courseId를 지정합니다.", annotations = McpTool.McpAnnotations(destructiveHint = false, openWorldHint = false))
    fun createNotesCourse(@McpToolParam(description = "분야·과목 이름·소개·IN_PROGRESS 또는 COMPLETED 상태") input: McpCourseInput) =
        calls.call { courses.create(input.validated()) }

    /** 입력 경계 검증 후 [CourseService.update]로 과목을 전체 교체. */
    @McpTool(name = "blog_update_notes_course", description = "Notes 과목 ID의 분야·이름·소개·상태를 전체 교체합니다. 회차 원고는 변경하지 않습니다.", annotations = McpTool.McpAnnotations(openWorldHint = false))
    fun updateNotesCourse(@McpToolParam(description = "양수 Notes 과목 ID") courseId: Long,
        @McpToolParam(description = "새 과목 속성 전체") input: McpCourseInput) =
        calls.call { courses.update(courseId, input.validated()) }

    /** @return 사용 프로젝트 수와 실제 로고 URL을 포함한 [StackBadgeService.listAdmin]. */
    @McpTool(name = "blog_list_stack_badges", description = "등록된 기술 스택 이름·ID·로고 URL·사용 프로젝트 수를 조회합니다. 새 로고 등록·교체는 별도 도구를 사용합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun listStackBadges() = calls.call { badges.listAdmin() }

    /** [io.github.gjaku1031.kenblog.note.dto.CourseRequests.write]와 같은 문자열 상한을 적용. */
    private fun McpCourseInput.validated(): CourseWriteRequest {
        val cleanField = field.trim()
        val cleanName = name.trim()
        val cleanDescription = description.trim()
        if (cleanField.isBlank() || cleanField.codePointCount(0, cleanField.length) > 100 ||
            cleanName.isBlank() || cleanName.codePointCount(0, cleanName.length) > 200 ||
            cleanDescription.isBlank() || cleanDescription.codePointCount(0, cleanDescription.length) > 500 ||
            listOf(cleanField, cleanName, cleanDescription).any { value -> value.any(Character::isISOControl) })
            throw InvalidCourseRequestException()
        return CourseWriteRequest(cleanField, cleanName, cleanDescription, status)
    }
}
