package io.github.gjaku1031.kenblog.content.service

import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component

/** 저장소 Markdown 원본을 읽기만 한다. 파일 생성·배포 동기화는 별도 운영 작업이다. */
@Component
class RepositoryMarkdown(@Value("\${app.content.directory:content}") directory: String) {
    private val root = Path.of(directory).toAbsolutePath().normalize()
    private val slugPattern = Regex("[a-z0-9]+(?:-[a-z0-9]+)*")

    /** 공개 파일 또는 기존 미출간 파일의 UTF-8 원문. DB 호환 열로 대체하지 않는다. */
    fun readPost(post: PostEntity): String {
        val path = pathFor(post)
        if (Files.isSymbolicLink(root) || Files.isSymbolicLink(path.parent) || Files.isSymbolicLink(path))
            throw OperationFailure(HttpStatus.CONFLICT, "Markdown 원본 경로가 심볼릭 링크입니다: ${sourcePath(post)}")
        try {
            val bytes = Files.readAllBytes(path)
            if (bytes.size > MAX_BYTES)
                throw OperationFailure(HttpStatus.CONFLICT, "Markdown 원본이 1 MiB를 초과합니다: ${sourcePath(post)}")
            return StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: NoSuchFileException) {
            throw OperationFailure(HttpStatus.NOT_FOUND, "Markdown 원본 파일이 없습니다: ${sourcePath(post)}")
        }
    }

    /** 관리자가 코드 또는 Git에서 수정할 상대 경로. */
    fun sourcePath(post: PostEntity): String =
        "content/${root.relativize(pathFor(post)).toString().replace('\\', '/')}"

    private fun pathFor(post: PostEntity): Path {
        check(slugPattern.matches(post.slug)) { "Invalid stored content slug" }
        val publicPath = root.resolve("posts").resolve("${post.slug}.md").normalize()
        val legacyPath = root.resolve("local-posts").resolve("${post.slug}.md").normalize()
        val path = when {
            post.visibility == PostVisibility.PRIVATE -> legacyPath
            post.status == PostStatus.PUBLISHED -> publicPath
            Files.exists(publicPath, LinkOption.NOFOLLOW_LINKS) -> publicPath
            Files.exists(legacyPath, LinkOption.NOFOLLOW_LINKS) -> legacyPath
            else -> publicPath
        }
        check(path.startsWith(root)) { "Markdown path escapes content root" }
        if (!Files.isDirectory(path.parent, LinkOption.NOFOLLOW_LINKS))
            throw OperationFailure(HttpStatus.NOT_FOUND,
                "Markdown 원본 디렉터리가 없습니다: content/${root.relativize(path)}")
        return path
    }

    private companion object { const val MAX_BYTES = 1024 * 1024 }
}
