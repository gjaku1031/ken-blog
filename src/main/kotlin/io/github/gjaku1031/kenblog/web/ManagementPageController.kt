package io.github.gjaku1031.kenblog.web

import io.github.gjaku1031.kenblog.auth.dto.LoginRequest
import io.github.gjaku1031.kenblog.auth.service.AuthService
import io.github.gjaku1031.kenblog.category.domain.CategoryNotFoundException
import io.github.gjaku1031.kenblog.category.dto.CategoryTreeResponse
import io.github.gjaku1031.kenblog.category.service.CategoryService
import io.github.gjaku1031.kenblog.note.domain.CourseConflictException
import io.github.gjaku1031.kenblog.note.domain.CourseNotFoundException
import io.github.gjaku1031.kenblog.note.domain.InvalidCourseRequestException
import io.github.gjaku1031.kenblog.note.dto.CourseRequests
import io.github.gjaku1031.kenblog.note.service.CourseService
import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.service.PostService
import io.github.gjaku1031.kenblog.profile.dto.HomeProfileRequest
import io.github.gjaku1031.kenblog.profile.service.HomeProfileService
import io.github.gjaku1031.kenblog.project.domain.InvalidProjectRequestException
import io.github.gjaku1031.kenblog.project.domain.ProjectConflictException
import io.github.gjaku1031.kenblog.project.domain.ProjectNotFoundException
import io.github.gjaku1031.kenblog.project.domain.ProjectStatus
import io.github.gjaku1031.kenblog.project.service.ProjectService
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.time.LocalDateTime
import java.time.format.DateTimeParseException
import org.springframework.http.HttpStatus
import org.springframework.security.authentication.BadCredentialsException
import org.springframework.security.core.Authentication
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler
import org.springframework.security.web.csrf.CsrfLogoutHandler
import org.springframework.security.web.csrf.CsrfToken
import org.springframework.security.web.csrf.CsrfTokenRepository
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.servlet.mvc.support.RedirectAttributes
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.ObjectMapper

/** 본문 없이 관리자 메타데이터를 렌더링하고 폼 변경을 기존 서비스에 전달. */
@Controller
class ManagementPageController(
    private val auth: AuthService,
    private val posts: PostService,
    private val projects: ProjectService,
    private val projectMetadata: ProjectMetadataManagementService,
    private val courses: CourseService,
    private val categories: CategoryService,
    private val profile: HomeProfileService,
    private val badges: StackBadgeService,
    private val assets: ManagementAssetManifest,
    private val mapper: ObjectMapper,
    csrfRepository: CsrfTokenRepository,
) {
    private val csrfLogout = CsrfLogoutHandler(csrfRepository)
    private val securityLogout = SecurityContextLogoutHandler()

    /** 로그인 폼에는 자격 증명이나 원고를 모델에 넣지 않음. */
    @GetMapping("/manage/login")
    fun loginPage(model: Model, csrfToken: CsrfToken, authentication: Authentication?): String {
        if (authentication?.authorities?.any { it.authority == "ROLE_ADMIN" } == true) return "redirect:/manage/"
        model.addAttribute("csrfToken", csrfToken)
        model.addAttribute("assets", assets.admin())
        return "manage/login"
    }

    /** 기존 비밀번호와 MFA 검증·세션 회전을 재사용한 뒤 새 CSRF 토큰으로 이동. */
    @PostMapping("/manage/login")
    fun login(@RequestParam password: String, @RequestParam verificationCode: String,
        @RequestParam(required = false, defaultValue = "false") rememberMe: Boolean,
        request: HttpServletRequest, response: HttpServletResponse, flash: RedirectAttributes): String = try {
        auth.login(LoginRequest(password, verificationCode, rememberMe), request, response)
        "redirect:/manage/"
    } catch (_: BadCredentialsException) {
        flash.addFlashAttribute("error", "비밀번호 또는 인증 코드를 확인하세요.")
        "redirect:/manage/login"
    } catch (ex: ResponseStatusException) {
        if (ex.statusCode.value() != HttpStatus.TOO_MANY_REQUESTS.value()) throw ex
        flash.addFlashAttribute("error", "로그인 시도가 잠시 제한되었습니다. 잠시 후 다시 시도하세요.")
        "redirect:/manage/login"
    }

    /** JDBC 세션과 CSRF를 모두 종료. */
    @PostMapping("/manage/logout")
    fun logout(authentication: Authentication, request: HttpServletRequest, response: HttpServletResponse): String {
        securityLogout.logout(request, response, authentication)
        csrfLogout.logout(request, response, authentication)
        return "redirect:/manage/login"
    }

    /** 본문 없는 페이지 목록과 현재 메타데이터를 렌더링. */
    @GetMapping("/manage", "/manage/")
    fun dashboard(@RequestParam(defaultValue = "0") page: Int, model: Model, csrfToken: CsrfToken): String {
        val safePage = page.coerceAtLeast(0)
        val postPage = posts.listDrafts(safePage, 30)
        val projectPage = projects.adminList(0, 100)
        model.addAttribute("posts", postPage)
        model.addAttribute("tagTexts", postPage.items.associate { it.id to it.tags.joinToString(", ") })
        model.addAttribute("projects", projectPage.items)
        model.addAttribute("projectBadgeIds", projectPage.items.associate { project ->
            project.id to project.stackBadges.map { it.id }.toSet()
        })
        model.addAttribute("courses", courses.adminList().items)
        model.addAttribute("categories", categories.tree(true, null).flatMap(::flattenCategory))
        model.addAttribute("profile", profile.get())
        model.addAttribute("badges", badges.list())
        model.addAttribute("projectStatuses", ProjectStatus.entries)
        model.addAttribute("page", safePage)
        model.addAttribute("hasPrevious", safePage > 0)
        model.addAttribute("hasNext", safePage + 1 < postPage.totalPages)
        model.addAttribute("csrfToken", csrfToken)
        model.addAttribute("assets", assets.admin())
        return "manage/dashboard"
    }

    /** 글 제목·요약·분류·태그만 변경하고 PRG로 목록을 다시 읽음. */
    @PostMapping("/manage/posts/{id}/metadata")
    fun postMetadata(@PathVariable id: Long, @RequestParam title: String, @RequestParam summary: String,
        @RequestParam(required = false) categoryId: String?, @RequestParam(defaultValue = "") tags: String,
        @RequestParam(defaultValue = "0") page: Int, flash: RedirectAttributes): String =
        changed(flash, "/manage/?page=${page.coerceAtLeast(0)}#posts") {
            val selectedCategory = categoryId?.takeIf(String::isNotBlank)?.toLongOrNull()
            if (!categoryId.isNullOrBlank() && selectedCategory == null) throw InvalidPostRequestException()
            posts.updateMetadata(id, title, summary, selectedCategory,
                tags.split(',').map(String::trim).filter(String::isNotEmpty))
        }

    /** 프로젝트 행 수정 시각을 확인하고 대문 속성과 뱃지만 저장. */
    @PostMapping("/manage/projects/{id}/metadata")
    fun projectMetadata(@PathVariable id: Long, @RequestParam name: String, @RequestParam status: String,
        @RequestParam startPeriod: String, @RequestParam(required = false) endPeriod: String?,
        @RequestParam overview: String, @RequestParam(required = false) stackBadgeNames: List<String>?,
        @RequestParam baseUpdatedAt: String, flash: RedirectAttributes): String = changed(flash, "/manage/#projects") {
        val selectedStatus = ProjectStatus.entries.find { it.name == status } ?: throw InvalidProjectRequestException()
        val base = try { LocalDateTime.parse(baseUpdatedAt) }
        catch (_: DateTimeParseException) { throw InvalidProjectRequestException() }
        projectMetadata.update(id, name, selectedStatus, startPeriod, endPeriod, overview,
            stackBadgeNames.orEmpty(), base)
    }

    /** Notes 과목 소개와 상태만 기존 검증·저장 서비스로 변경. */
    @PostMapping("/manage/courses/{id}/metadata")
    fun courseMetadata(@PathVariable id: Long, @RequestParam field: String, @RequestParam name: String,
        @RequestParam description: String, @RequestParam status: String, flash: RedirectAttributes): String =
        changed(flash, "/manage/#courses") {
            val node = mapper.createObjectNode().put("field", field).put("name", name)
                .put("description", description).put("status", status)
            courses.update(id, CourseRequests.write(node))
        }

    /** 홈 소개의 공개 텍스트만 저장. 사진 업로드 입력은 제공하지 않음. */
    @PostMapping("/manage/profile")
    fun profile(@RequestParam name: String, @RequestParam tagline: String, @RequestParam intro: String,
        @RequestParam github: String, @RequestParam(defaultValue = "") email: String,
        flash: RedirectAttributes): String = changed(flash, "/manage/#profile") {
        profile.update(HomeProfileRequest(name, tagline, intro, github, email))
    }

    /** 검증 오류를 사용자에게 표시하고 성공시에만 완료 메시지를 남김. */
    private fun changed(flash: RedirectAttributes, path: String, action: () -> Unit): String {
        var destination = path
        try {
            action()
            flash.addFlashAttribute("notice", "메타데이터를 저장했습니다. 공개 사이트 반영은 GitHub Actions의 Pages 워크플로를 수동 실행하세요.")
        } catch (ex: RuntimeException) {
            val message = when (ex) {
                is OperationFailure -> ex.publicDetail
                is ProjectConflictException, is CourseConflictException -> "다른 변경과 충돌했습니다. 새로고침 후 다시 확인하세요."
                is InvalidProjectRequestException, is InvalidCourseRequestException,
                is InvalidPostRequestException,
                is CategoryNotFoundException -> "입력값을 확인하세요."
                is ProjectNotFoundException, is CourseNotFoundException, is PostNotFoundException -> "대상을 찾을 수 없습니다."
                else -> throw ex
            }
            flash.addFlashAttribute("error", message)
            destination = path.substringBefore('#')
        }
        return "redirect:$destination"
    }

    /** 트리 분류를 선택 상자의 읽기 전용 평면 목록으로 펼침. */
    private fun flattenCategory(node: CategoryTreeResponse): List<CategoryTreeResponse> =
        listOf(node) + node.children.flatMap(::flattenCategory)
}
