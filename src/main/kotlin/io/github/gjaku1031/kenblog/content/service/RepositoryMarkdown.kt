package io.github.gjaku1031.kenblog.content.service

import io.github.gjaku1031.kenblog.draft.repository.EditorDraftRepository
import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import io.github.gjaku1031.kenblog.post.domain.PostBodyHash
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import jakarta.annotation.PostConstruct
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.LinkOption
import java.nio.file.attribute.PosixFilePermission
import java.nio.file.attribute.PosixFilePermissions
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager

/** 저장소 Markdown을 원본으로 읽고, 기존 DB 본문은 첫 초기화의 파일 부재에만 사용. */
@Component
class RepositoryMarkdown(
    private val posts: PostRepository,
    private val drafts: EditorDraftRepository,
    private val jdbc: JdbcTemplate,
    @Value("\${app.content.directory:content}") directory: String,
) {
    private val root = Path.of(directory).toAbsolutePath().normalize()
    private val slugPattern = Regex("[a-z0-9]+(?:-[a-z0-9]+)*")
    private val hashPattern = Regex("[a-f0-9]{64}")

    /** 첫 초기화의 파일 부재인 원고만 가져오며 이후 공개 파일 누락은 실패로 알림. */
    @PostConstruct
    fun importMissing() {
        directory(root)
        directory(root.resolve("posts"))
        directory(root.resolve("local-posts"))
        directory(root.resolve("local-drafts"))
        directory(root.resolve(".pending"))
        val marker = root.resolve(".initialized")
        check(!Files.isSymbolicLink(marker)) { "Content initialization marker is symbolic link" }
        val initialized = Files.exists(marker)
        posts.findAll().forEach { post ->
            if (post.status != PostStatus.PUBLISHED || post.visibility != PostVisibility.PUBLIC)
                check(!Files.exists(path(post.slug, "posts"))) { "Unpublished Markdown exists in public content path" }
            val postFile = postPath(post)
            if (initialized && post.status == PostStatus.PUBLISHED && post.visibility == PostVisibility.PUBLIC)
                check(Files.exists(postFile)) { "Published Markdown is missing after initialization" }
            if (post.status == PostStatus.PUBLISHED && post.visibility == PostVisibility.PUBLIC &&
                !Files.exists(postFile))
                putIfAbsent(pendingPath(post.slug), PostBodyHash.sha256(post.body))
            putIfAbsent(postFile, post.body)
        }
        drafts.findAll().forEach { draft ->
            val id = draft.id ?: error("Persisted draft has no ID")
            putIfAbsent(draftPath(id), draft.body)
            draft.postId?.let { postId ->
                posts.findById(postId).ifPresent { post -> putIfAbsent(draftBasePath(id), post.bodySha256) }
            }
        }
        putIfAbsent(marker, "repository-markdown-v1\n")
    }

    /** 공개 글은 추적 대상, 미출간 글은 gitignore 대상 디렉터리에서 읽음. */
    fun readPost(post: PostEntity): String = read(postPath(post))

    /** 편집본 파일의 현재 바이트를 반환하며 DB 복사본으로 조용히 대체하지 않음. */
    fun readDraft(id: Long): String = read(draftPath(id))

    /** 현재 트랜잭션 실패 시 원래 파일을 되돌리는 원자적 전체 교체. */
    fun writePost(post: PostEntity, body: String) {
        if (post.status == PostStatus.PUBLISHED && post.visibility == PostVisibility.PUBLIC)
            replace(pendingPath(post.slug), PostBodyHash.sha256(body))
        replace(postPath(post), body)
    }

    /** 미출간 편집본을 비추적 파일에 저장. */
    fun writeDraft(id: Long, body: String) = replace(draftPath(id), body)

    /** 편집 시작 당시 원본 파일 해시를 별도 비추적 파일에 고정. */
    fun writeDraftBase(id: Long, hash: String) = replace(draftBasePath(id), hash)

    /** 발행 직전 원본 파일과 비교할 편집 기준 해시. */
    fun readDraftBase(id: Long): String = read(draftBasePath(id))

    /** 삭제된 원고의 파일을 트랜잭션 롤백 시 복구. */
    fun deletePost(post: PostEntity) {
        remove(postPath(post))
        remove(pendingPath(post.slug))
    }

    /** 삭제된 편집본의 파일을 트랜잭션 롤백 시 복구. */
    fun deleteDraft(id: Long) {
        remove(draftPath(id))
        remove(draftBasePath(id))
    }

    /** 발행 또는 철회 시 현재 본문을 목적지에 복사하고 이전 위치를 제거. */
    fun movePost(post: PostEntity, published: Boolean) {
        val source = path(post.slug, if (published) "local-posts" else "posts")
        val target = path(post.slug, if (published) "posts" else "local-posts")
        if (published) check(!Files.exists(target)) { "Public Markdown already exists" }
        val body = read(source)
        if (published) replace(pendingPath(post.slug), PostBodyHash.sha256(body))
        replace(target, body)
        remove(source)
        if (!published) remove(pendingPath(post.slug))
    }

    /** 배포 전 커밋·push가 필요한 공개 파일의 slug별 SHA-256. */
    fun pendingSources(): Map<String, String> {
        val pending = root.resolve(".pending")
        checkDirectory(pending)
        Files.list(pending).use { files ->
            return files.filter { !it.fileName.toString().startsWith(".markdown-") }
                .toList().sortedBy { it.fileName.toString() }.associate { file ->
                val name = file.fileName.toString()
                check(name.endsWith(".sha256")) { "Unexpected pending source file" }
                val slug = name.removeSuffix(".sha256")
                check(slugPattern.matches(slug)) { "Invalid pending source slug" }
                val hash = read(file)
                check(hashPattern.matches(hash)) { "Invalid pending source hash" }
                slug to hash
            }
        }
    }

    /** 공개 capture에 포함되는 원고의 미반영 해시만 workflow에 제공. */
    fun pendingVisibleSources(): Map<String, String> {
        val visible = visiblePublishedSlugs()
        return pendingSources().filterKeys { it in visible }
    }

    /** workflow checkout의 공개 본문 전체를 확인한 뒤 파일과 DB 호환 복사본을 동기화. */
    @Transactional
    fun synchronizePublishedSources(bodies: Map<String, String>): Int {
        if (bodies.size > MAX_POSTS || bodies.keys.any { !slugPattern.matches(it) }) badRequest()
        val expected = visiblePublishedSlugs()
        if (bodies.keys != expected) conflict()
        var total = 0L
        val hashes = bodies.mapValues { (_, body) ->
            val bytes = body.toByteArray(Charsets.UTF_8)
            if (bytes.size > MAX_BYTES) badRequest()
            total += bytes.size
            if (total > MAX_TOTAL_BYTES) badRequest()
            PostBodyHash.sha256(body)
        }
        val pending = pendingSources().filterKeys { it in expected }
        if (pending.any { (slug, hash) -> hashes[slug] != hash ||
                PostBodyHash.sha256(read(path(slug, "posts"))) != hash }) conflict()
        // 모든 slug·본문·pending 비교가 끝난 뒤에만 파일 또는 DB를 변경.
        bodies.forEach { (slug, body) ->
            replace(path(slug, "posts"), body)
            val changed = jdbc.update(
                "update posts set body = ?, body_sha256 = ? where slug = ? and status = 'PUBLISHED' and visibility = 'PUBLIC'",
                body, hashes.getValue(slug), slug)
            if (changed != 1) conflict()
        }
        pending.keys.forEach { remove(pendingPath(it)) }
        return bodies.size
    }

    /** 공개 상세 API와 같은 부모 출간·공개 조건의 slug 집합. */
    private fun visiblePublishedSlugs(): Set<String> = jdbc.queryForList(
        "select p.slug from posts p " +
            "left join projects project on project.id = p.project_id " +
            "left join posts home on home.id = project.home_post_id " +
            "left join courses course on course.id = p.course_id " +
            "where p.status = 'PUBLISHED' and p.visibility = 'PUBLIC' and (" +
            "p.section = 'TECH' or (p.section = 'NOTE_CHAPTER' and course.id is not null) or " +
            "(p.section = 'PROJECT_HOME' and project.visibility = 'PUBLIC' and project.home_post_id = p.id) or " +
            "(p.section = 'PROJECT_DOC' and project.visibility = 'PUBLIC' and home.status = 'PUBLISHED' " +
            "and home.visibility = 'PUBLIC' and home.section = 'PROJECT_HOME' and home.project_id = project.id))",
        String::class.java).map { it ?: conflict() }.toSet()

    /** GitHub 수정본을 읽을 수 있게 파일명을 slug 규칙으로 제한. */
    private fun path(slug: String, folder: String): Path {
        check(slugPattern.matches(slug)) { "Invalid stored content slug" }
        return root.resolve(folder).resolve("$slug.md")
    }

    private fun postPath(post: PostEntity): Path =
        path(post.slug, if (post.status == PostStatus.PUBLISHED && post.visibility == PostVisibility.PUBLIC) "posts" else "local-posts")

    private fun draftPath(id: Long): Path {
        check(id > 0) { "Invalid stored draft ID" }
        return root.resolve("local-drafts").resolve("$id.md")
    }

    private fun draftBasePath(id: Long): Path = draftPath(id).resolveSibling("$id.base")

    private fun pendingPath(slug: String): Path {
        check(slugPattern.matches(slug)) { "Invalid pending source slug" }
        return root.resolve(".pending").resolve("$slug.sha256")
    }

    private fun read(file: Path): String {
        checkDirectory(file.parent)
        check(!Files.isSymbolicLink(file) && !Files.isSymbolicLink(file.parent)) { "Markdown path is symbolic link" }
        val bytes = Files.readAllBytes(file)
        check(bytes.size <= MAX_BYTES) { "Markdown body exceeds 1 MiB" }
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    }

    private fun putIfAbsent(file: Path, body: String): Boolean {
        directory(file.parent)
        check(!Files.isSymbolicLink(file) && !Files.isSymbolicLink(file.parent)) { "Markdown path is symbolic link" }
        val temporary = Files.createTempFile(file.parent, ".markdown-", ".tmp")
        try {
            Files.setPosixFilePermissions(temporary, FILE_PERMISSIONS)
            writeAndSync(temporary, body.toByteArray(Charsets.UTF_8))
            try { Files.createLink(file, temporary) }
            catch (ex: java.nio.file.FileAlreadyExistsException) { return false }
            syncDirectory(file.parent)
            return true
        } finally { if (Files.deleteIfExists(temporary)) syncDirectory(file.parent) }
    }

    private fun replace(file: Path, body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        check(bytes.size <= MAX_BYTES) { "Markdown body exceeds 1 MiB" }
        requireTransaction()
        check(!Files.isSymbolicLink(file) && !Files.isSymbolicLink(file.parent)) { "Markdown path is symbolic link" }
        val previous = if (Files.exists(file)) Files.readAllBytes(file) else null
        atomicWrite(file, bytes)
        rollback {
            if (Files.exists(file) && Files.readAllBytes(file).contentEquals(bytes)) {
                if (previous == null) {
                    Files.deleteIfExists(file)
                    syncDirectory(file.parent)
                } else atomicWrite(file, previous)
            }
        }
    }

    private fun remove(file: Path) {
        requireTransaction()
        check(!Files.isSymbolicLink(file) && !Files.isSymbolicLink(file.parent)) { "Markdown path is symbolic link" }
        val previous = if (Files.exists(file)) Files.readAllBytes(file) else null
        if (Files.deleteIfExists(file)) syncDirectory(file.parent)
        rollback { if (previous != null && !Files.exists(file)) atomicWrite(file, previous) }
    }

    private fun atomicWrite(file: Path, bytes: ByteArray) {
        directory(file.parent)
        val temporary = Files.createTempFile(file.parent, ".markdown-", ".tmp")
        try {
            Files.setPosixFilePermissions(temporary, FILE_PERMISSIONS)
            writeAndSync(temporary, bytes)
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            syncDirectory(file.parent)
        } finally { Files.deleteIfExists(temporary) }
    }

    /** 파일 내용과 디렉터리 항목을 각각 동기화해 정상 반환 시 디스크에 반영. */
    private fun writeAndSync(file: Path, bytes: ByteArray) {
        FileChannel.open(file, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING).use { channel ->
            val buffer = ByteBuffer.wrap(bytes)
            while (buffer.hasRemaining()) channel.write(buffer)
            channel.force(true)
        }
    }

    private fun syncDirectory(path: Path) {
        FileChannel.open(path, StandardOpenOption.READ).use { it.force(true) }
    }

    /** 그룹 쓰기와 setgid를 유지하고 symlink로 루트 밖에 쓰는 것을 차단. */
    private fun directory(path: Path) {
        check(!Files.isSymbolicLink(root)) { "Content root is symbolic link" }
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) Files.createDirectories(path)
        checkDirectory(path)
        val currentMode = Files.getAttribute(path, "unix:mode", LinkOption.NOFOLLOW_LINKS) as Int
        if (currentMode and PERMISSION_MASK != DIRECTORY_MODE)
            Files.setAttribute(path, "unix:mode", DIRECTORY_MODE, LinkOption.NOFOLLOW_LINKS)
        syncDirectory(path)
    }

    private fun checkDirectory(path: Path) {
        check(!Files.isSymbolicLink(root) && !Files.isSymbolicLink(path) &&
            Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) { "Content directory is missing or symbolic link" }
    }

    private fun badRequest(): Nothing = throw OperationFailure(HttpStatus.BAD_REQUEST, "공개 Markdown 원본 입력을 확인하세요.")
    private fun conflict(): Nothing = throw OperationFailure(HttpStatus.CONFLICT,
        "저장소 Markdown 커밋·push가 필요하거나 공개 원본 집합이 변경됐습니다.")

    private fun requireTransaction() {
        check(TransactionSynchronizationManager.isActualTransactionActive() &&
            TransactionSynchronizationManager.isSynchronizationActive()) { "Markdown mutation requires a transaction" }
    }

    private fun rollback(action: () -> Unit) {
        @Suppress("UNCHECKED_CAST")
        val existing = TransactionSynchronizationManager.getResource(this) as? MutableList<() -> Unit>
        if (existing != null) { existing += action; return }
        val actions = mutableListOf(action)
        TransactionSynchronizationManager.bindResource(this, actions)
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCompletion(status: Int) {
                TransactionSynchronizationManager.unbindResourceIfPossible(this@RepositoryMarkdown)
                if (status != TransactionSynchronization.STATUS_COMMITTED) actions.asReversed().forEach { it() }
            }
        })
    }

    private companion object {
        const val MAX_BYTES = 1024 * 1024
        const val MAX_POSTS = 2000
        const val MAX_TOTAL_BYTES = 128L * 1024 * 1024
        val FILE_PERMISSIONS: Set<PosixFilePermission> = PosixFilePermissions.fromString("rw-rw----")
        val DIRECTORY_MODE: Int = Integer.parseInt("2770", 8)
        val PERMISSION_MASK: Int = Integer.parseInt("7777", 8)
    }
}
