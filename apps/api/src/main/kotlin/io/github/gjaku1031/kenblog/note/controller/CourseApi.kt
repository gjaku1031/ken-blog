package io.github.gjaku1031.kenblog.note.controller

import io.github.gjaku1031.kenblog.note.dto.CourseAdminDetailResponse
import io.github.gjaku1031.kenblog.note.dto.CourseAdminResponse
import io.github.gjaku1031.kenblog.note.dto.CourseChapterResponse
import io.github.gjaku1031.kenblog.note.dto.CourseDetailResponse
import io.github.gjaku1031.kenblog.note.dto.NotesListResponse
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.responses.ApiResponses
import io.swagger.v3.oas.annotations.security.SecurityRequirement
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import tools.jackson.databind.JsonNode

/** Notes 분야·과목·회차 읽기를 [CourseController]에 연결하는 HTTP 계약. */
@RequestMapping("/api/v1/notes")
interface CourseApi {
    /** @return 현재 역할의 회차 수를 가진 과목 목록. */
    @GetMapping
    @Operation(summary = "Notes 과목 목록")
    fun list(authentication: Authentication?): ResponseEntity<NotesListResponse>

    /** @return 과목 소개와 읽을 수 있는 회차 목록. */
    @GetMapping("/{slug}")
    @Operation(summary = "과목 소개와 회차 목록")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "404")])
    fun detail(@PathVariable slug: String, authentication: Authentication?): ResponseEntity<CourseDetailResponse>

    /** @return 과목 소속과 현재 역할을 확인한 회차 본문. */
    @GetMapping("/{slug}/chapters/{chapterSlug}")
    @Operation(summary = "Notes 회차 읽기")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "404")])
    fun chapter(@PathVariable slug: String, @PathVariable chapterSlug: String,
        authentication: Authentication?): ResponseEntity<CourseChapterResponse>
}

/** 과목 속성·회차 삭제와 순서를 [AdminCourseController]에 연결하는 관리자 HTTP 계약. */
@RequestMapping("/api/v1/admin/courses")
@SecurityRequirement(name = "sessionCookie")
interface AdminCourseApi {
    /** @return 비공개를 포함한 전체 과목 목록. */
    @GetMapping
    @Operation(summary = "관리자 과목 목록")
    fun list(): ResponseEntity<NotesListResponse>

    /** @return 전체 회차를 포함한 관리자 상세. */
    @GetMapping("/{id}")
    @Operation(summary = "관리자 과목 상세")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "404")])
    fun detail(@PathVariable id: Long): ResponseEntity<CourseAdminDetailResponse>

    /** @return 출간 전 과목을 생성한 HTTP 201. */
    @PostMapping
    @Operation(summary = "과목 생성")
    @ApiResponses(value = [ApiResponse(responseCode = "201"), ApiResponse(responseCode = "400"), ApiResponse(responseCode = "409")])
    fun create(@RequestBody request: JsonNode): ResponseEntity<CourseAdminResponse>

    /** @return 수정한 과목 속성. */
    @PutMapping("/{id}")
    @Operation(summary = "과목 수정")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400"), ApiResponse(responseCode = "404"), ApiResponse(responseCode = "409")])
    fun update(@PathVariable id: Long, @RequestBody request: JsonNode): ResponseEntity<CourseAdminResponse>

    /** @return 과목과 회차 연결을 제거한 HTTP 204. */
    @DeleteMapping("/{id}")
    @Operation(summary = "과목 삭제")
    @ApiResponses(value = [ApiResponse(responseCode = "204"), ApiResponse(responseCode = "404"), ApiResponse(responseCode = "409")])
    fun delete(@PathVariable id: Long): ResponseEntity<Void>

    /** @return 지정한 회차 하나를 제거한 HTTP 204. */
    @DeleteMapping("/{id}/chapters/{postId}")
    @Operation(summary = "과목 회차 삭제")
    @ApiResponses(value = [ApiResponse(responseCode = "204"), ApiResponse(responseCode = "404"), ApiResponse(responseCode = "409")])
    fun deleteChapter(@PathVariable id: Long, @PathVariable postId: Long): ResponseEntity<Void>

    /** @return 회차 전체 순열을 검증해 적용한 관리자 상세. */
    @PutMapping("/{id}/chapters/order")
    @Operation(summary = "과목 회차 순서 변경")
    @ApiResponses(value = [ApiResponse(responseCode = "200"), ApiResponse(responseCode = "400"), ApiResponse(responseCode = "404"), ApiResponse(responseCode = "409")])
    fun reorder(@PathVariable id: Long, @RequestBody request: JsonNode): ResponseEntity<CourseAdminDetailResponse>
}
