package io.github.gjaku1031.kenblog.attachment.controller

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import io.github.gjaku1031.kenblog.attachment.dto.AttachmentResponse
import io.github.gjaku1031.kenblog.attachment.service.AttachmentService
import jakarta.servlet.http.HttpServletRequest
import java.nio.charset.StandardCharsets
import org.springframework.http.ContentDisposition
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.multipart.MultipartHttpServletRequest
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody

/** [AttachmentApi]의 관리자 요청을 [AttachmentService]에 연결하고 안전한 다운로드 헤더를 구성. */
@RestController
class AttachmentController(private val service: AttachmentService) : AttachmentApi {
    /**
     * 요청 전체의 파일 항목이 정확히 하나인지 확인하고 인증 계정으로 업로드.
     *
     * @param file `file` 항목의 원본 이미지
     * @param request 중복 파일 항목을 검사할 multipart 요청
     * @param authentication 현재 관리자 계정
     * @return READY [AttachmentResponse]와 HTTP 201
     */
    override fun upload(file: MultipartFile, request: HttpServletRequest, authentication: Authentication): ResponseEntity<AttachmentResponse> {
        val multipart = request as? MultipartHttpServletRequest
            ?: throw AttachmentFailure(HttpStatus.BAD_REQUEST, "이미지 파일 하나가 필요합니다.")
        if (multipart.multiFileMap.values.sumOf { it.size } != 1 || multipart.getFiles("file").size != 1) {
            throw AttachmentFailure(HttpStatus.BAD_REQUEST, "이미지 파일 하나가 필요합니다.")
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(service.upload(file, authentication.name))
    }

    /** @return 상태를 포함하고 object key를 숨긴 [AttachmentResponse]. */
    override fun find(id: Long): AttachmentResponse = service.find(id)

    /**
     * OCI 스트림을 응답 전에 열어 오류 상태를 판별한 뒤 원본 바이트를 전송.
     *
     * @param id READY 첨부 식별자
     * @return 길이·MIME·nosniff·비공개 캐시·RFC 5987 파일명을 가진 응답
     */
    override fun content(id: Long): ResponseEntity<StreamingResponseBody> {
        val content = service.open(id)
        val body = StreamingResponseBody { output -> content.stream.use { it.copyTo(output) } }
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(content.metadata.contentType))
            .contentLength(content.metadata.byteSize)
            .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                .filename(content.metadata.originalFilename, StandardCharsets.UTF_8).build().toString())
            .header("X-Content-Type-Options", "nosniff")
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .body(body)
    }

    /**
     * 객체와 메타데이터 삭제가 모두 끝난 경우에만 HTTP 204를 반환.
     *
     * @param id 첨부 식별자
     * @return 본문 없는 응답
     * @throws AttachmentFailure 처리 중이거나 추적 행이 유예 중이면 HTTP 409
     */
    override fun delete(id: Long): ResponseEntity<Void> {
        service.delete(id)
        return ResponseEntity.noContent().build()
    }
}
