package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import io.github.gjaku1031.kenblog.attachment.storage.LocalAssetStorage
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.springframework.http.HttpStatus

/** 실제 디스크에서 기존 key·재기동 보존·경로 격리와 실패 시 파일 보존을 검증. */
class LocalAssetStorageTest {
    @TempDir
    lateinit var directory: Path

    /** 저장소 객체를 다시 만들어도 DB key로 같은 바이트를 읽고 반복 삭제할 수 있음. */
    @Test
    fun `files survive storage recreation and deletion is idempotent`() {
        val root = directory.resolve("storage")
        Files.createDirectory(root)
        val storage = LocalAssetStorage(root.toString(), "ken-blog/attachments")
        val key = storage.newKey("png")
        val bytes = byteArrayOf(1, 2, 3)
        storage.put(key, bytes, "image/png")
        val reopened = LocalAssetStorage(root.toString(), "ken-blog/attachments")
        reopened.open(key).use { assertArrayEquals(bytes, it.readAllBytes()) }
        reopened.delete(key)
        reopened.delete(key)
        assertFalse(Files.exists(root.resolve(key)))
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, assertThrows<AttachmentFailure> { reopened.open(key) }.status)
    }

    /** 기존 DB의 접두사 key는 새 파일 생성 접두사와 달라도 그대로 조회 가능. */
    @Test
    fun `existing keys remain readable after prefix changes`() {
        val root = directory.resolve("storage")
        val key = "ken-blog/attachments/123e4567-e89b-12d3-a456-426614174000.jpg"
        Files.createDirectory(root)
        val storage = LocalAssetStorage(root.toString(), "new-prefix")
        storage.put(key, byteArrayOf(4), "image/jpeg")
        storage.open(key).use { assertArrayEquals(byteArrayOf(4), it.readAllBytes()) }
        assertTrue(storage.newKey("jpg").startsWith("new-prefix/"))
    }

    /** 잘못된 DB key도 루트 밖 파일의 조회·생성·삭제에 사용할 수 없음. */
    @Test
    fun `path traversal and absolute paths cannot reach outside files`() {
        Files.createDirectory(directory.resolve("storage"))
        val storage = LocalAssetStorage(directory.resolve("storage").toString(), "attachments")
        val outside = directory.resolve("outside.png")
        Files.write(outside, byteArrayOf(5))
        for (key in listOf("../outside.png", outside.toString(), "attachments/../../outside.png", "attachments\\outside.png")) {
            assertThrows<AttachmentFailure> { storage.open(key) }
            assertThrows<AttachmentFailure> { storage.put(key, byteArrayOf(6), "image/png") }
            assertThrows<AttachmentFailure> { storage.delete(key) }
        }
        assertArrayEquals(byteArrayOf(5), Files.readAllBytes(outside))
    }

    /** 저장소 내부의 디렉터리·파일 링크로 외부 원본을 접근할 수 없음. */
    @Test
    fun `symlink parents and files cannot expose or alter outside files`() {
        assumeTrue(directory.fileSystem.supportedFileAttributeViews().contains("posix"))
        val root = directory.resolve("storage")
        Files.createDirectory(root)
        val storage = LocalAssetStorage(root.toString(), "attachments")
        val outside = directory.resolve("outside")
        Files.createDirectory(outside)
        val filename = "123e4567-e89b-12d3-a456-426614174000.png"
        Files.write(outside.resolve(filename), byteArrayOf(7))
        Files.createSymbolicLink(root.resolve("linked"), outside)
        Files.createDirectory(root.resolve("attachments"))
        Files.createSymbolicLink(root.resolve("attachments").resolve(filename), outside.resolve(filename))
        for (key in listOf("linked/$filename", "attachments/$filename")) {
            assertThrows<AttachmentFailure> { storage.open(key) }
            assertThrows<AttachmentFailure> { storage.put(key, byteArrayOf(8), "image/png") }
            assertThrows<AttachmentFailure> { storage.delete(key) }
        }
        assertArrayEquals(byteArrayOf(7), Files.readAllBytes(outside.resolve(filename)))
    }

    /** key 중복 실패는 기존 파일을 훼손하거나 업로드 임시 파일을 남기지 않음. */
    @Test
    fun `a duplicate write preserves the existing file and leaves no temporary files`() {
        val root = directory.resolve("storage")
        Files.createDirectory(root)
        val storage = LocalAssetStorage(root.toString(), "attachments")
        val key = storage.newKey("png")
        storage.put(key, byteArrayOf(9), "image/png")
        assertThrows<AttachmentFailure> { storage.put(key, byteArrayOf(10), "image/png") }
        assertArrayEquals(byteArrayOf(9), Files.readAllBytes(root.resolve(key)))
        Files.list(root.resolve("attachments")).use { assertEquals(1L, it.count()) }
    }

    /** Linux에서 새 저장 디렉터리와 파일은 서버 사용자만 접근 가능. */
    @Test
    fun `new files and directories have owner only permissions`() {
        assumeTrue(directory.fileSystem.supportedFileAttributeViews().contains("posix"))
        val root = directory.resolve("storage")
        Files.createDirectory(root, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")))
        val storage = LocalAssetStorage(root.toString(), "attachments")
        val key = storage.newKey("png")
        storage.put(key, byteArrayOf(11), "image/png")
        assertEquals(PosixFilePermissions.fromString("rwx------"), Files.getPosixFilePermissions(root))
        assertEquals(PosixFilePermissions.fromString("rwx------"), Files.getPosixFilePermissions(root.resolve("attachments")))
        assertEquals(PosixFilePermissions.fromString("rw-------"), Files.getPosixFilePermissions(root.resolve(key)))
    }

    /** 저장소 루트 자체가 링크인 설정은 기동 시 거부. */
    @Test
    fun `a symlink storage root is rejected`() {
        assumeTrue(directory.fileSystem.supportedFileAttributeViews().contains("posix"))
        val link = directory.resolve("storage")
        Files.createSymbolicLink(link, directory)
        assertThrows<AttachmentFailure> { LocalAssetStorage(link.toString(), "attachments").requireConfigured() }
    }
}
