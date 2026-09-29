package io.github.gjaku1031.kenblog.attachment.service

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.Locale
import javax.imageio.ImageIO
import javax.imageio.stream.MemoryCacheImageInputStream
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.multipart.MultipartFile

/** 검증된 원본 바이트와 서버가 판별한 MIME·안전한 표시 이름. */
data class ValidatedImage(val bytes: ByteArray, val contentType: String, val extension: String, val filename: String)

/**
 * 업로드 파일의 크기·시그니처·디코딩·픽셀 상한을 OCI 쓰기 전에 검증.
 *
 * [ImageIO]가 이미지 전체를 디코딩하기 전에 너비·높이·픽셀 수를 먼저 제한함.
 */
@Component
class AttachmentImageValidator {
    /**
     * 파일명·선언 MIME을 실제 바이트 형식과 대조해 저장 가능한 이미지로 변환.
     *
     * @param file 단일 multipart 파일
     * @return 원본 바이트와 실제 형식에서 확정한 [ValidatedImage]
     * @throws AttachmentFailure 형식·크기·이름이 허용 범위를 벗어날 때
     */
    fun validate(file: MultipartFile): ValidatedImage {
        if (file.size > MAX_BYTES) throw AttachmentFailure(HttpStatus.PAYLOAD_TOO_LARGE, "이미지 크기 상한을 초과했습니다.")
        val bytes = try {
            file.bytes
        } catch (_: IOException) {
            throw AttachmentFailure(HttpStatus.SERVICE_UNAVAILABLE, "업로드 파일을 읽을 수 없습니다.")
        }
        if (bytes.size > MAX_BYTES) throw AttachmentFailure(HttpStatus.PAYLOAD_TOO_LARGE, "이미지 크기 상한을 초과했습니다.")
        val format = when {
            bytes.size >= PNG_SIGNATURE.size && PNG_SIGNATURE.indices.all { bytes[it] == PNG_SIGNATURE[it] } -> ImageFormat.PNG
            bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte() -> ImageFormat.JPEG
            else -> throw unsupported()
        }
        val filename = safeFilename(file.originalFilename, format)
        val declaredType = file.contentType?.lowercase(Locale.ROOT)
        if (declaredType != null && declaredType != format.contentType) throw unsupported()
        if (bytes.isEmpty()) throw unsupported()
        verifyDecode(bytes, format)
        return ValidatedImage(bytes, format.contentType, format.extension, filename)
    }

    /**
     * OS 경로·제어문자를 거부하고 원본 이름을 다운로드 표시 용도로 제한.
     *
     * @param originalName 클라이언트가 전달한 파일 이름
     * @param format 실제 바이트에서 판별한 이미지 형식
     * @return 길이와 확장자를 확인한 안전한 이름
     * @throws AttachmentFailure 이름이 없거나 위장 확장자·경로를 포함할 때
     */
    private fun safeFilename(originalName: String?, format: ImageFormat): String {
        val name = originalName?.trim() ?: ""
        if (name.isEmpty() || name.codePointCount(0, name.length) > MAX_FILENAME_LENGTH ||
            name.any { it == '/' || it == '\\' || Character.isISOControl(it) || Character.getType(it) == Character.FORMAT.toInt() }
        ) throw AttachmentFailure(HttpStatus.BAD_REQUEST, "파일 이름을 사용할 수 없습니다.")
        val extension = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
        if (extension !in format.allowedExtensions) throw unsupported()
        return name
    }

    /**
     * 시그니처와 디코더의 형식을 대조하고 전체 이미지를 실제로 디코딩.
     *
     * @param bytes 최대 10 MiB의 원본 파일
     * @param format 시그니처로 판별한 JPEG 또는 PNG
     * @throws AttachmentFailure 손상·형식 불일치·과도한 픽셀 수일 때
     */
    private fun verifyDecode(bytes: ByteArray, format: ImageFormat) {
        try {
            MemoryCacheImageInputStream(ByteArrayInputStream(bytes)).use { input ->
                val readers = ImageIO.getImageReaders(input)
                if (!readers.hasNext()) throw unsupported()
                val reader = readers.next()
                try {
                    reader.input = input
                    if (reader.formatName.lowercase(Locale.ROOT) !in format.readerNames) throw unsupported()
                    val width = reader.getWidth(0)
                    val height = reader.getHeight(0)
                    if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION ||
                        width.toLong() * height > MAX_PIXELS
                    ) throw unsupported()
                    if (reader.read(0) == null) throw unsupported()
                } finally {
                    reader.dispose()
                }
            }
        } catch (ex: AttachmentFailure) {
            throw ex
        } catch (_: IOException) {
            throw unsupported()
        } catch (_: RuntimeException) {
            throw unsupported()
        }
    }

    /** @return 내용이 지원하지 않거나 손상되었음을 나타내는 고정 오류. */
    private fun unsupported(): AttachmentFailure = AttachmentFailure(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "지원하지 않거나 손상된 이미지입니다.")

    /** 실제 시그니처별 MIME, 저장 확장자, 허용 파일명 확장자와 디코더 형식을 연결. */
    private enum class ImageFormat(val contentType: String, val extension: String, val allowedExtensions: Set<String>, val readerNames: Set<String>) {
        JPEG("image/jpeg", "jpg", setOf("jpg", "jpeg"), setOf("jpeg", "jpg")),
        PNG("image/png", "png", setOf("png"), setOf("png")),
    }

    private companion object {
        const val MAX_BYTES = 10L * 1024 * 1024
        const val MAX_DIMENSION = 8192
        const val MAX_PIXELS = 20_000_000L
        const val MAX_FILENAME_LENGTH = 180
        val PNG_SIGNATURE = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    }
}
