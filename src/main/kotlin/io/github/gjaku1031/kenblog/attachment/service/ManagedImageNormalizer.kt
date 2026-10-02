package io.github.gjaku1031.kenblog.attachment.service

import io.github.gjaku1031.kenblog.global.error.BusinessException
import java.awt.AlphaComposite
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.multipart.MultipartFile

/** 기술 뱃지를 서버에서 안전한 64×64 PNG로 변환. */
@Component
class ManagedImageNormalizer {
    /**
     * JPEG/PNG를 확인하고 비율을 유지해 투명 캔버스 중앙에 배치.
     *
     * @param file 브라우저에서 보낸 단일 이미지
     * @return 원본 메타데이터와 분리된 PNG 바이트
     * @throws BusinessException 형식·크기·디코딩 실패일 때
     */
    fun normalize(file: MultipartFile): ByteArray {
        val size = 64
        if (file.isEmpty || file.size > 10L * 1024 * 1024) badImage()
        val source = file.bytes
        if (!isPng(source) && !isJpeg(source)) badImage()
        val input = ImageIO.createImageInputStream(ByteArrayInputStream(source)) ?: badImage()
        val decoded = input.use { stream ->
            val readers = ImageIO.getImageReaders(stream)
            if (!readers.hasNext()) badImage()
            val reader = readers.next()
            try {
                reader.input = stream
                val width = reader.getWidth(0)
                val height = reader.getHeight(0)
                if (width !in 1..4096 || height !in 1..4096 || width.toLong() * height > 16_777_216) badImage()
                reader.read(0) ?: badImage()
            } catch (_: Exception) {
                badImage()
            } finally {
                reader.dispose()
            }
        }
        val target = BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB)
        val graphics = target.createGraphics()
        try {
            graphics.composite = AlphaComposite.Src
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC)
            graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY)
            val scale = minOf(size.toDouble() / decoded.width, size.toDouble() / decoded.height)
            val width = (decoded.width * scale).toInt().coerceAtLeast(1)
            val height = (decoded.height * scale).toInt().coerceAtLeast(1)
            graphics.drawImage(decoded, (size - width) / 2, (size - height) / 2, width, height, null)
        } finally {
            graphics.dispose()
        }
        return ByteArrayOutputStream().use { output ->
            if (!ImageIO.write(target, "png", output)) badImage()
            output.toByteArray()
        }
    }

    /** @return PNG 시그니처가 있는지 여부. */
    private fun isPng(bytes: ByteArray): Boolean = bytes.size >= 8 &&
        bytes.take(8) == listOf(137, 80, 78, 71, 13, 10, 26, 10).map(Int::toByte)

    /** @return JPEG 시작 마커가 있는지 여부. */
    private fun isJpeg(bytes: ByteArray): Boolean = bytes.size >= 3 &&
        bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte()

    /** @return 이미지 검증 실패를 안전한 HTTP 415로 전환. */
    private fun badImage(): Nothing = throw BusinessException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "JPEG 또는 PNG 이미지를 확인하세요.")
}
