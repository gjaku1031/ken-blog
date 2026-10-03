package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import io.github.gjaku1031.kenblog.attachment.dto.AttachmentDeliveryRow
import io.github.gjaku1031.kenblog.attachment.service.PostAttachmentDeliveryService
import io.github.gjaku1031.kenblog.attachment.storage.LocalAssetStorage
import io.github.gjaku1031.kenblog.post.repository.PostQueries
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.api.assertThrows
import org.mockito.Mockito
import org.springframework.http.HttpStatus
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions

/**
 * DB 전달 정보와 이미 연 파일의 실제 크기 대조 검사
 */
class AttachmentDeliveryTest {
    /**
     * 실제 파일 핸들을 검증할 임시 저장 루트
     */
    @TempDir
    lateinit var directory: Path

    /**
     * 정상 전달을 먼저 확인한 뒤 잘못된 MIME·길이와 실제 파일 크기 불일치 거부
     */
    @Test
    fun validatesDeliveryMetadataBeforeHeaders() {
        val key = "attachments/123e4567-e89b-12d3-a456-426614174000.png"
        Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwxr-x---"))
        Files.createDirectory(directory.resolve("attachments"), PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwxr-x---")))
        val bytes = byteArrayOf(1, 2, 3)
        Files.write(directory.resolve(key), bytes)
        val queries = Mockito.mock(PostQueries::class.java)
        val service = PostAttachmentDeliveryService(queries, LocalAssetStorage(directory.toString()))
        Mockito.`when`(queries.readableAttachment(1, 1)).thenReturn(AttachmentDeliveryRow(key, "image/png", 3))
        service.open(1, 1).stream.use { assertArrayEquals(bytes, it.readAllBytes()) }
        for ((type, size) in listOf("text/html" to 3L, "image/png" to 0L, "image/png" to -1L,
            "image/png" to 10_485_761L, "image/png" to 4L)) {
            Mockito.`when`(queries.readableAttachment(1, 1)).thenReturn(AttachmentDeliveryRow(key, type, size))
            assertEquals(HttpStatus.SERVICE_UNAVAILABLE, assertThrows<AttachmentFailure> { service.open(1, 1) }.status)
        }
        assertArrayEquals(bytes, Files.readAllBytes(directory.resolve(key)))
    }
}
