package io.github.gjaku1031.kenblog.attachment.storage

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import java.io.InputStream
import java.nio.channels.Channels
import java.nio.channels.FileChannel
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.OpenOption
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermission
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component

/**
 * 서버가 생성한 객체 key를 영속 로컬 디렉터리 안의 비공개 파일로 보관.
 *
 * [directory]는 재배포 뒤에도 남는 절대경로이며, 기존 DB의 객체 key를 그대로 상대경로로 사용함.
 * 저장 루트와 하위 경로의 심볼릭 링크를 거부하고 파일 게시 전에 같은 디렉터리에서 내용을 완성함.
 */
@Component
class LocalAssetStorage(
    @Value("\${app.assets.directory:}") directory: String,
    @Value("\${app.assets.key-prefix:ken-blog/attachments}") private val keyPrefix: String,
) {
    private val root: Path? = directory.trim().takeIf(String::isNotEmpty)?.let { Path.of(it).toAbsolutePath().normalize() }

    init {
        check(directory.isBlank() || Path.of(directory.trim()).isAbsolute) { "Asset directory must be absolute" }
        check(root == null || root != root.root) { "Asset directory cannot be the filesystem root" }
        check(keyPrefix.length in 1..160 && keyPrefix.matches(PREFIX)) { "Asset key prefix is invalid" }
    }

    /** @return 기존 OCI key와 동일한 접두사 및 UUID 형식의 새 이미지 key. */
    fun newKey(extension: String): String {
        check(extension == "jpg" || extension == "png") { "Unsupported asset extension" }
        return "$keyPrefix/${UUID.randomUUID()}.$extension"
    }

    /** 저장 루트가 설정되고 실제 디렉터리로 열릴 수 있는지 확인. */
    fun requireConfigured() {
        val base = root ?: throw unavailable()
        try {
            ensureDirectory(base)
        } catch (_: Exception) {
            throw unavailable()
        }
    }

    /**
     * 이미지 바이트를 비공개 임시 파일에 기록하고 완성된 파일만 [key]에 게시.
     * 이미 존재하는 key는 덮어쓰지 않으며 실패한 임시 파일은 제거함.
     */
    fun put(key: String, bytes: ByteArray, contentType: String) {
        check(contentType == "image/jpeg" || contentType == "image/png") { "Unsupported asset content type" }
        requireConfigured()
        val path = resolve(key)
        val parent = path.parent
        var temporary: Path? = null
        try {
            ensureDirectory(parent)
            temporary = Files.createTempFile(parent, ".upload-", ".tmp", PRIVATE_FILE)
            FileChannel.open(temporary, StandardOpenOption.WRITE).use { channel ->
                var written = 0
                while (written < bytes.size) written += channel.write(java.nio.ByteBuffer.wrap(bytes, written, bytes.size - written))
                channel.force(true)
            }
            checkSafePath(path)
            Files.createLink(path, temporary)
            syncDirectory(parent)
        } catch (_: Exception) {
            throw unavailable()
        } finally {
            temporary?.let { runCatching { Files.deleteIfExists(it) } }
        }
    }

    /** @return 호출자가 닫아야 하는 원본 파일 스트림. 심볼릭 링크는 따르지 않음. */
    fun open(key: String): InputStream {
        requireConfigured()
        val path = resolve(key)
        try {
            checkSafePath(path)
            return Channels.newInputStream(FileChannel.open(path,
                setOf<OpenOption>(StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)))
        } catch (_: Exception) {
            throw unavailable()
        }
    }

    /** 없는 파일은 성공으로 취급하고, 주어진 key의 일반 파일만 삭제. */
    fun delete(key: String) {
        requireConfigured()
        val path = resolve(key)
        try {
            checkSafePath(path)
            if (Files.deleteIfExists(path)) syncDirectory(path.parent)
        } catch (_: Exception) {
            throw unavailable()
        }
    }

    /** @return 검증된 객체 key가 가리키는 저장 루트 내부의 경로. */
    private fun resolve(key: String): Path {
        val base = root ?: throw unavailable()
        if (key.length > 255 || !KEY.matches(key)) throw unavailable()
        val path = base.resolve(key).normalize()
        if (!path.startsWith(base) || path == base) throw unavailable()
        return path
    }

    /** 루트부터 대상까지 링크와 비디렉터리 조상을 거부. */
    private fun checkSafePath(path: Path) {
        var current = path.root ?: throw unavailable()
        for (part in path) {
            current = current.resolve(part)
            if (Files.isSymbolicLink(current)) throw unavailable()
            if (current != path && Files.exists(current, LinkOption.NOFOLLOW_LINKS) &&
                !Files.isDirectory(current, LinkOption.NOFOLLOW_LINKS)) throw unavailable()
            if (current != path && current.startsWith(root ?: throw unavailable()) &&
                Files.exists(current, LinkOption.NOFOLLOW_LINKS)) ensurePrivateDirectory(current)
        }
        if (Files.exists(path, LinkOption.NOFOLLOW_LINKS) && !Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS))
            throw unavailable()
    }

    /** 경로의 각 단계가 일반 디렉터리인지 검사하고 빠진 디렉터리를 비공개 권한으로 생성. */
    private fun ensureDirectory(directory: Path) {
        var current = directory.root ?: throw unavailable()
        for (part in directory) {
            current = current.resolve(part)
            if (!Files.exists(current, LinkOption.NOFOLLOW_LINKS)) {
                if (current == root || !current.startsWith(root ?: throw unavailable())) throw unavailable()
                try { Files.createDirectory(current, PRIVATE_DIRECTORY) }
                catch (_: FileAlreadyExistsException) { /* 동시 생성은 아래에서 검사. */ }
            }
            if (Files.isSymbolicLink(current) || !Files.isDirectory(current, LinkOption.NOFOLLOW_LINKS)) throw unavailable()
            if (current.startsWith(root ?: throw unavailable())) ensurePrivateDirectory(current)
        }
    }

    /** 저장 루트 아래에서 타 계정이 파일 이름을 바꾸거나 링크를 끼울 수 없도록 확인. */
    private fun ensurePrivateDirectory(directory: Path) {
        val permissions = Files.getPosixFilePermissions(directory, LinkOption.NOFOLLOW_LINKS)
        if (PosixFilePermission.GROUP_WRITE in permissions || PosixFilePermission.OTHERS_WRITE in permissions)
            throw unavailable()
    }

    /** 파일 이름의 생성·삭제를 파일 내용과 별도로 동기화. */
    private fun syncDirectory(directory: Path) {
        FileChannel.open(directory, StandardOpenOption.READ).use { it.force(true) }
    }

    /** @return 경로나 내부 I/O 원인을 공개하지 않는 고정 503 오류. */
    private fun unavailable(): AttachmentFailure = AttachmentFailure(HttpStatus.SERVICE_UNAVAILABLE, "첨부 저장소를 사용할 수 없습니다.")

    private companion object {
        val PREFIX = Regex("[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*")
        val KEY = Regex("[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*/[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\\.(?:jpg|png)")
        val PRIVATE_DIRECTORY = java.nio.file.attribute.PosixFilePermissions.asFileAttribute(
            setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE, PosixFilePermission.OWNER_EXECUTE))
        val PRIVATE_FILE = java.nio.file.attribute.PosixFilePermissions.asFileAttribute(
            setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE))
    }
}
