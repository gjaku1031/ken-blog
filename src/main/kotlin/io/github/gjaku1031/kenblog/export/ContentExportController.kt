package io.github.gjaku1031.kenblog.export

import org.springframework.http.CacheControl
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody

/** 관리자 세션으로 모든 글·편집본 또는 지정 원본 글을 ZIP으로 내려받음. */
@RestController
class ContentExportController(private val service: ContentExportService) {
    @GetMapping("/api/v1/admin/export", produces = ["application/zip"])
    fun export(@RequestParam(defaultValue = "false") all: Boolean,
        @RequestParam(required = false) postId: Long?,
        @RequestParam(required = false) projectId: Long?,
        @RequestParam(required = false) courseId: Long?,
        @RequestParam(defaultValue = "false") includeDrafts: Boolean): ResponseEntity<StreamingResponseBody> {
        val documents = service.snapshot(all, postId, projectId, courseId, includeDrafts)
        val archive = service.prepare(documents)
        val filename = when {
            postId != null -> "ken-blog-post-$postId.zip"
            projectId != null -> "ken-blog-project-$projectId.zip"
            courseId != null -> "ken-blog-course-$courseId.zip"
            else -> "ken-blog-export.zip"
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"$filename\"")
            .contentType(MediaType.parseMediaType("application/zip"))
            .contentLength(archive.length)
            .body(StreamingResponseBody { output -> archive.copyTo(output) })
    }
}
