package io.github.gjaku1031.kenblog.post.controller

import io.github.gjaku1031.kenblog.post.dto.WikiLinkResolveResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.Parameter
import io.swagger.v3.oas.annotations.Parameters
import io.swagger.v3.oas.annotations.enums.Explode
import io.swagger.v3.oas.annotations.enums.ParameterIn
import io.swagger.v3.oas.annotations.enums.ParameterStyle
import io.swagger.v3.oas.annotations.media.ArraySchema
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping

/** 반복 title을 원래 값·순서로 받는 공개 위키 링크 대상 조회 HTTP/OpenAPI 계약. */
@RequestMapping("/api/v1/wiki-links")
interface WikiLinkApi {
    /**
     * `title=A%2CB&title=D`를 쉼표로 분할하지 않고 두 제목으로 조회.
     *
     * @param request 원래 인코딩 길이와 반복 title 값을 제공하는 Servlet 요청
     * @param authentication PRIVATE 열람에 사용할 USER·ADMIN 세션 또는 익명 인증
     * @return 캐시하지 않는 입력 순서의 [WikiLinkResolveResponse]
     */
    @GetMapping("/resolve", produces = [MediaType.APPLICATION_JSON_VALUE])
    @Operation(summary = "위키 링크 제목 대상 조회", description = "출간 글만 선택하며 익명 PRIVATE는 대상 메타데이터 없는 LOCKED로 반환")
    @Parameters(value = [
        Parameter(name = "title", `in` = ParameterIn.QUERY, required = true,
            style = ParameterStyle.FORM, explode = Explode.TRUE,
            description = "반복 title=값으로 1~20개 전달. 쉼표는 제목 문자이며 각 값은 공백 제거 후 1~200 Unicode codepoints. 원래 값의 UTF-8 합계 1500바이트 이하.",
            array = ArraySchema(schema = Schema(type = "string"), arraySchema = Schema(type = "array"), minItems = 1, maxItems = 20)),
    ])
    @ApiResponses(value = [
        ApiResponse(responseCode = "200", description = "요청 순서의 READABLE·LOCKED·MISSING", content = [Content(schema = Schema(implementation = WikiLinkResolveResponse::class))]),
        ApiResponse(responseCode = "400", description = "title·쿼리·길이 오류", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
        ApiResponse(responseCode = "503", description = "DB 또는 세션 저장소 장애", content = [Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = Schema(implementation = ProblemDetail::class))]),
    ])
    fun resolve(@Parameter(hidden = true) request: HttpServletRequest,
        @Parameter(hidden = true) authentication: Authentication?): ResponseEntity<WikiLinkResolveResponse>
}
