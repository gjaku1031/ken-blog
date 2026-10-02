package io.github.gjaku1031.kenblog.attachment.storage

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import java.io.InputStream
import java.nio.channels.Channels
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.OpenOption
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermission
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component

/**
 * DB의 객체 key로 영속 로컬 디렉터리의 이미지 파일을 조회.
 *
 * [directory]는 재배포 뒤에도 남는 절대경로이며, 기존 DB의 객체 key를 그대로 상대경로로 사용함.
 * 저장 루트와 하위 경로의 심볼릭 링크·불안전한 디렉터리 권한을 거부하며 파일 쓰기는 수행하지 않음.
 */
@Component
class LocalAssetStorage(
    @Value("\${app.assets.directory:}") directory: String,
) {
    private val root: Path? = directory.trim().takeIf(String::isNotEmpty)?.let { Path.of(it).toAbsolutePath().normalize() }

    init {
        check(directory.isBlank() || Path.of(directory.trim()).isAbsolute) { "Asset directory must be absolute" }
        check(root == null || root != root.root) { "Asset directory cannot be the filesystem root" }
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

    /** 경로의 각 단계가 이미 준비된 일반 디렉터리인지 검사. */
    private fun ensureDirectory(directory: Path) {
        var current = directory.root ?: throw unavailable()
        for (part in directory) {
            current = current.resolve(part)
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

    /** @return 경로나 내부 I/O 원인을 공개하지 않는 고정 503 오류. */
    private fun unavailable(): AttachmentFailure = AttachmentFailure(HttpStatus.SERVICE_UNAVAILABLE, "첨부 저장소를 사용할 수 없습니다.")

    private companion object {
        val KEY = Regex("[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*/[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\\.(?:jpg|png)")
    }
}
