package io.github.gjaku1031.kenblog.stack.controller

import io.github.gjaku1031.kenblog.stack.dto.StackBadgeResponse
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController

/** 관리자 기술 목록 조회와 공개 아이콘을 [StackBadgeService]에 연결. */
@RestController
class StackBadgeController(private val service: StackBadgeService) {
    /** @return 프로젝트 선택에 사용할 등록 기술 목록. */
    @GetMapping("/api/v1/admin/stack-badges")
    fun listAdmin(): List<StackBadgeResponse> = service.listAdmin()

    /** 경로 검증 후 같은 요청 스레드에서 PNG 전송·입력 스트림 종료. */
    @GetMapping("/api/v1/stack-badges/{id}/image", produces = [MediaType.IMAGE_PNG_VALUE])
    fun image(@PathVariable id: Long, response: HttpServletResponse) {
        service.openImage(id).use { stream ->
            response.contentType = MediaType.IMAGE_PNG_VALUE
            response.setHeader("X-Content-Type-Options", "nosniff")
            response.setHeader(HttpHeaders.CACHE_CONTROL, "public, max-age=300")
            stream.copyTo(response.outputStream)
        }
    }
}
