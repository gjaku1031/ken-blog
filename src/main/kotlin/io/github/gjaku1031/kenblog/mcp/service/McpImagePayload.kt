package io.github.gjaku1031.kenblog.mcp.service

import io.github.gjaku1031.kenblog.mcp.dto.McpImageInput
import io.github.gjaku1031.kenblog.global.error.BusinessException
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.util.Base64
import org.springframework.http.HttpStatus
import org.springframework.web.multipart.MultipartFile

/** VM 로컬 MCP의 인라인 이미지 바이트를 기존 이미지 검증 서비스 입력으로 변환. */
class McpImagePayload private constructor(
    private val filename: String,
    private val mimeType: String,
    private val bytes: ByteArray,
) : MultipartFile {
    override fun getName(): String = "file"
    override fun getOriginalFilename(): String = filename
    override fun getContentType(): String = mimeType
    override fun isEmpty(): Boolean = bytes.isEmpty()
    override fun getSize(): Long = bytes.size.toLong()
    override fun getBytes(): ByteArray = bytes.copyOf()
    override fun getInputStream(): InputStream = ByteArrayInputStream(bytes)

    /** 서버 경로를 인자로 받는 쓰기는 MCP 업로드 계약 밖이므로 거부. */
    override fun transferTo(dest: File) { throw UnsupportedOperationException("MCP image is memory only") }

    companion object {
        private const val MAX_BYTES = 10 * 1024 * 1024
        private const val MAX_BASE64_CHARS = (MAX_BYTES + 2) / 3 * 4

        /** Base64 크기·MIME·파일명만 먼저 확인하고 실제 이미지 판별은 기존 서비스에 맡김. */
        fun decode(input: McpImageInput): McpImagePayload {
            if (input.base64.isEmpty() || input.base64.length > MAX_BASE64_CHARS ||
                input.filename.isBlank() || input.filename.length > 180 ||
                input.filename.any { it == '/' || it == '\\' || Character.isISOControl(it) } ||
                input.mimeType !in setOf("image/png", "image/jpeg")) badInput()
            val bytes = try { Base64.getDecoder().decode(input.base64) }
                catch (_: IllegalArgumentException) { badInput() }
            if (bytes.isEmpty() || bytes.size > MAX_BYTES) badInput()
            return McpImagePayload(input.filename, input.mimeType, bytes)
        }

        /** @throws BusinessException 원문을 제외한 안전한 이미지 입력 오류. */
        private fun badInput(): Nothing = throw BusinessException(HttpStatus.BAD_REQUEST, "이미지 파일명·MIME·Base64·크기를 확인하세요.")
    }
}
