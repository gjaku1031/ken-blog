package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import io.github.gjaku1031.kenblog.attachment.storage.LocalAssetStorage
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.springframework.http.HttpStatus

/**
 * 실제 디스크에서 기존 key·재기동 보존·경로 격리와 실패 시 파일 보존을 검증
 */
class LocalAssetStorageTest {
    /**
     * 테스트용 임시 디렉터리
     */
    @TempDir
    lateinit var directory: Path

    /**
     * 외부에서 준비한 파일을 저장소 객체 재생성 후에도 같은 DB key로 조회
     *
     * 1. 외부에서 준비한 저장 루트와 파일 생성
     * 2. 저장소 객체 재생성 후 같은 key로 바이트 조회
     * 3. 외부에서 파일을 지운 뒤 503용 예외 확인
     */
    @Test
    fun `externally prepared files survive storage recreation`() {
        // 외부에서 준비한 저장 루트와 파일 생성
        val root = directory.resolve("storage")
        Files.createDirectory(root)
        val key = "ken-blog/attachments/123e4567-e89b-12d3-a456-426614174000.png"
        val bytes = byteArrayOf(1, 2, 3)
        Files.createDirectories(root.resolve(key).parent)
        Files.write(root.resolve(key), bytes)
        // 저장소 객체 재생성 후 같은 key로 바이트 조회
        val reopened = LocalAssetStorage(root.toString())
        reopened.open(key).use { assertArrayEquals(bytes, it.readAllBytes()) }
        // 외부에서 파일을 지운 뒤 503용 예외 확인
        Files.delete(root.resolve(key))
        assertFalse(Files.exists(root.resolve(key)))
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, assertThrows<AttachmentFailure> { reopened.open(key) }.status)
    }

    /**
     * 기존 DB의 접두사 key를 별도 접두사 설정 없이 조회 가능
     */
    @Test
    fun `existing keys remain readable without prefix configuration`() {
        val root = directory.resolve("storage")
        val key = "ken-blog/attachments/123e4567-e89b-12d3-a456-426614174000.jpg"
        Files.createDirectory(root)
        val storage = LocalAssetStorage(root.toString())
        Files.createDirectories(root.resolve(key).parent)
        Files.write(root.resolve(key), byteArrayOf(4))
        storage.open(key).use { assertArrayEquals(byteArrayOf(4), it.readAllBytes()) }
    }

    /**
     * 잘못된 DB key도 루트 밖 파일의 조회에 사용할 수 없음
     *
     * 1. 저장소 밖 원본 파일과 저장 루트 준비
     * 2. 상위 경로·절대경로·역슬래시 입력의 접근 거부 확인
     * 3. 거부 후 외부 원본 보존 확인
     */
    @Test
    fun `path traversal and absolute paths cannot reach outside files`() {
        // 저장소 밖 원본 파일과 저장 루트 준비
        Files.createDirectory(directory.resolve("storage"))
        val storage = LocalAssetStorage(directory.resolve("storage").toString())
        val outside = directory.resolve("outside.png")
        Files.write(outside, byteArrayOf(5))
        // 상위 경로·절대경로·역슬래시 입력의 접근 거부 확인
        for (key in listOf("../outside.png", outside.toString(), "attachments/../../outside.png", "attachments\\outside.png")) {
            assertThrows<AttachmentFailure> { storage.open(key) }
        }
        // 거부 후 외부 원본 보존 확인
        assertArrayEquals(byteArrayOf(5), Files.readAllBytes(outside))
    }

    /**
     * 저장소 내부의 디렉터리·파일 링크로 외부 원본을 접근할 수 없음
     *
     * 1. 심볼릭 링크를 검증할 POSIX 파일시스템에서 실행
     * 2. 외부 파일을 가리키는 디렉터리·파일 링크 구성
     * 3. 두 링크 경로의 접근 거부와 외부 원본 보존 확인
     */
    @Test
    fun `symlink parents and files cannot expose or alter outside files`() {
        // 심볼릭 링크를 검증할 POSIX 파일시스템에서 실행
        assumeTrue(directory.fileSystem.supportedFileAttributeViews().contains("posix"))
        val root = directory.resolve("storage")
        Files.createDirectory(root)
        val storage = LocalAssetStorage(root.toString())
        val outside = directory.resolve("outside")
        Files.createDirectory(outside)
        val filename = "123e4567-e89b-12d3-a456-426614174000.png"
        Files.write(outside.resolve(filename), byteArrayOf(7))
        // 외부 파일을 가리키는 디렉터리·파일 링크 구성
        Files.createSymbolicLink(root.resolve("linked"), outside)
        Files.createDirectory(root.resolve("attachments"))
        Files.createSymbolicLink(root.resolve("attachments").resolve(filename), outside.resolve(filename))
        // 두 링크 경로의 접근 거부와 외부 원본 보존 확인
        for (key in listOf("linked/$filename", "attachments/$filename")) {
            assertThrows<AttachmentFailure> { storage.open(key) }
        }
        assertArrayEquals(byteArrayOf(7), Files.readAllBytes(outside.resolve(filename)))
    }

    /**
     * 저장소 루트 자체가 링크인 설정은 파일 조회 전에 거부
     */
    @Test
    fun `a symlink storage root is rejected`() {
        assumeTrue(directory.fileSystem.supportedFileAttributeViews().contains("posix"))
        val link = directory.resolve("storage")
        Files.createSymbolicLink(link, directory)
        assertThrows<AttachmentFailure> { LocalAssetStorage(link.toString()).requireConfigured() }
    }
}
