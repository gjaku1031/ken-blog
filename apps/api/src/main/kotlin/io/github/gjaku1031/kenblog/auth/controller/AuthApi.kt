package io.github.gjaku1031.kenblog.auth.controller

import io.github.gjaku1031.kenblog.auth.dto.CsrfResponse
import io.github.gjaku1031.kenblog.auth.dto.CurrentUserResponse
import io.github.gjaku1031.kenblog.auth.dto.LoginRequest
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.Parameter
import io.swagger.v3.oas.annotations.enums.ParameterIn
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.security.web.csrf.CsrfToken
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping

/**
 * 세션 CSRF 발급과 로그인·현재 사용자·로그아웃의 HTTP/OpenAPI 계약.
 *
 * [AuthController]가 구현하며 공개 계정 생성 경로는 없음.
 */
@RequestMapping("/api/v1/auth")
interface AuthApi {
    /**
     * 익명 사용자도 세션별 CSRF 토큰을 발급받음.
     *
     * @param token Spring Security가 현재 세션에 연결한 토큰
     * @return 헤더 이름과 전송할 [CsrfResponse]
     */
    @GetMapping("/csrf", produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "세션 CSRF 토큰 발급")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = CsrfResponse::class))]),
        ApiResponse(responseCode = "503", description = "세션 저장소 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun csrf(@Parameter(hidden = true) token: CsrfToken): CsrfResponse

    /**
     * 올바른 CSRF 헤더와 계정 정보로 로그인하고 세션 ID를 교체.
     *
     * @param body 계정명과 비밀번호
     * @param request 현재 요청 및 기존 세션
     * @param response 새 세션 쿠키를 내보낼 응답
     * @return 인증된 [CurrentUserResponse]
     */
    @PostMapping("/login", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "관리자 세션 로그인", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true, description = "GET /api/v1/auth/csrf에서 받은 토큰")])
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = CurrentUserResponse::class))]),
        ApiResponse(responseCode = "401", description = "계정 정보 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "CSRF 토큰 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "세션 저장소 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun login(
        @RequestBody body: LoginRequest,
        @Parameter(hidden = true) request: HttpServletRequest,
        @Parameter(hidden = true) response: HttpServletResponse,
    ): CurrentUserResponse

    /**
     * 유효한 세션의 현재 사용자 이름과 권한을 조회.
     *
     * @param authentication 세션에서 복원한 인증 정보
     * @return 현재 [CurrentUserResponse], 세션이 없으면 HTTP 401
     */
    @GetMapping("/me", produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "현재 로그인 계정 조회")
    @SecurityRequirement(name = "sessionCookie")
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", content = [Content(schema = Schema(implementation = CurrentUserResponse::class))]),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "세션 저장소 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun me(@Parameter(hidden = true) authentication: Authentication): CurrentUserResponse

    /**
     * 유효한 CSRF 헤더와 세션으로 로그아웃하고 기존 세션을 삭제.
     *
     * @param authentication 현재 세션 인증 정보
     * @param request 삭제할 세션을 담은 요청
     * @param response 세션 쿠키 제거를 담을 응답
     * @return 본문 없는 HTTP 204
     */
    @PostMapping("/logout")
    @Operation(summary = "현재 세션 로그아웃", parameters = [Parameter(name = "X-CSRF-TOKEN", `in` = ParameterIn.HEADER, required = true, description = "현재 세션의 CSRF 토큰")])
    @SecurityRequirement(name = "sessionCookie")
    @ApiResponses(value = [
        ApiResponse(responseCode = "204", description = "세션 삭제"),
        ApiResponse(responseCode = "401", description = "인증 필요", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "403", description = "CSRF 토큰 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "세션 저장소 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun logout(
        @Parameter(hidden = true) authentication: Authentication,
        @Parameter(hidden = true) request: HttpServletRequest,
        @Parameter(hidden = true) response: HttpServletResponse,
    ): ResponseEntity<Void>
}
