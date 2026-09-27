package io.github.gjaku1031.kenblog.note.controller

import io.github.gjaku1031.kenblog.note.dto.CourseRequests
import io.github.gjaku1031.kenblog.note.dto.NotesListResponse
import io.github.gjaku1031.kenblog.note.dto.CourseDetailResponse
import io.github.gjaku1031.kenblog.note.dto.CourseChapterResponse
import io.github.gjaku1031.kenblog.note.dto.CourseAdminResponse
import io.github.gjaku1031.kenblog.note.dto.CourseAdminDetailResponse
import io.github.gjaku1031.kenblog.note.service.CourseService
import java.net.URI
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.JsonNode

/** [CourseService]의 분야·과목·회차 읽기를 공개 Notes 주소로 제공. */
@RestController
class CourseController(private val service: CourseService) : CourseApi {
    /** @return 현재 역할의 회차 수를 가진 모든 과목. */
    override fun list(authentication: Authentication?): ResponseEntity<NotesListResponse> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore()).body(service.list(authentication))

    /** @return 과목 소개와 현재 역할의 회차 탐색 목록. */
    override fun detail(slug: String, authentication: Authentication?): ResponseEntity<CourseDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.detail(slug, authentication))

    /** @return 과목 소속과 현재 역할을 다시 확인한 본문·표시 번호. */
    override fun chapter(slug: String, chapterSlug: String,
        authentication: Authentication?): ResponseEntity<CourseChapterResponse> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore()).body(service.chapter(slug, chapterSlug, authentication))
}

/** 과목 속성·회차 삭제와 순서를 ADMIN 세션에서만 조작. */
@RestController
class AdminCourseController(private val service: CourseService) : AdminCourseApi {
    /** @return 현재 과목의 생성 순서 목록. */
    override fun list(): ResponseEntity<NotesListResponse> = ResponseEntity.ok().cacheControl(CacheControl.noStore())
        .body(service.adminList())

    /** @return 회차 초안까지 포함한 관리자 과목 상세. */
    override fun detail(id: Long): ResponseEntity<CourseAdminDetailResponse> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore()).body(service.adminDetail(id))

    /** @return 과목 소개를 DB에 생성한 HTTP 201. */
    override fun create(request: JsonNode): ResponseEntity<CourseAdminResponse> {
        val created = service.create(CourseRequests.write(request))
        return ResponseEntity.created(URI.create("/api/v1/admin/courses/${created.id}"))
            .cacheControl(CacheControl.noStore()).body(created)
    }

    /** @return 현재 과목 소개를 전체 교체한 관리자 값. */
    override fun update(id: Long, request: JsonNode): ResponseEntity<CourseAdminResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.update(id, CourseRequests.write(request)))

    /** @return 과목과 DB 회차 링크를 함께 삭제한 HTTP 204. */
    override fun delete(id: Long): ResponseEntity<Void> {
        service.delete(id)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }

    /** @return 지정 과목의 회차 한 건을 삭제한 HTTP 204. */
    override fun deleteChapter(id: Long, postId: Long): ResponseEntity<Void> {
        service.deleteChapter(id, postId)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }

    /** @return 현재 회차 전체 집합과 일치하는 순서를 적용한 상세. */
    override fun reorder(id: Long, request: JsonNode): ResponseEntity<CourseAdminDetailResponse> =
        ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(service.reorder(id, CourseRequests.order(request)))
}
