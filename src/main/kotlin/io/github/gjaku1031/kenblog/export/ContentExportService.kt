package io.github.gjaku1031.kenblog.export

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentStatus
import io.github.gjaku1031.kenblog.content.service.RepositoryMarkdown
import io.github.gjaku1031.kenblog.post.domain.PostBodyHash
import io.github.gjaku1031.kenblog.attachment.repository.AttachmentRepository
import io.github.gjaku1031.kenblog.attachment.repository.EditorDraftAttachmentRepository
import io.github.gjaku1031.kenblog.attachment.repository.PostAttachmentRepository
import io.github.gjaku1031.kenblog.attachment.storage.LocalAssetStorage
import io.github.gjaku1031.kenblog.draft.repository.EditorDraftRepository
import io.github.gjaku1031.kenblog.draft.repository.EditorDraftWikiLinkRepository
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import io.github.gjaku1031.kenblog.post.repository.PostTagRepository
import io.github.gjaku1031.kenblog.post.repository.PostWikiLinkRepository
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.project.repository.ProjectRepository
import io.github.gjaku1031.kenblog.note.repository.CourseRepository
import java.io.OutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermission
import java.util.concurrent.TimeUnit
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.springframework.data.repository.findByIdOrNull
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.ObjectMapper
import org.commonmark.node.Image
import org.commonmark.node.Node
import org.commonmark.parser.IncludeSourceSpans
import org.commonmark.parser.Parser

/** 원문과 로컬 첨부를 별도 DB 트랜잭션·스트림 단계로 ZIP에 내보냄. */
@Service
class ContentExportService(
    private val posts: PostRepository,
    private val projects: ProjectRepository,
    private val courses: CourseRepository,
    private val drafts: EditorDraftRepository,
    private val postAttachments: PostAttachmentRepository,
    private val draftAttachments: EditorDraftAttachmentRepository,
    private val postTags: PostTagRepository,
    private val postWikiLinks: PostWikiLinkRepository,
    private val draftWikiLinks: EditorDraftWikiLinkRepository,
    private val attachments: AttachmentRepository,
    private val storage: LocalAssetStorage,
    private val mapper: ObjectMapper,
    private val markdown: RepositoryMarkdown,
) {
    /** 스트림 시작 전 DB 원본과 READY 첨부의 불변 스냅샷을 수집. */
    @Transactional(readOnly = true)
    fun snapshot(all: Boolean, postId: Long?, projectId: Long?, courseId: Long?, includeDrafts: Boolean): List<ExportDocument> {
        val selectors = listOfNotNull(postId, projectId, courseId)
        if (selectors.size > 1 || selectors.any { it <= 0 } || all == selectors.isNotEmpty()) throw InvalidPostRequestException()
        val selected = when {
            postId != null -> {
                val post = posts.findByIdOrNull(postId) ?: throw PostNotFoundException()
                if (!includeDrafts && (post.status != PostStatus.PUBLISHED || post.visibility != PostVisibility.PUBLIC))
                    throw PostNotFoundException()
                listOf(post)
            }
            projectId != null -> {
                if (!projects.existsById(projectId)) throw PostNotFoundException()
                posts.findAll().filter { it.projectId == projectId &&
                    (includeDrafts || it.status == PostStatus.PUBLISHED && it.visibility == PostVisibility.PUBLIC) }
            }
            courseId != null -> {
                if (!courses.existsById(courseId)) throw PostNotFoundException()
                posts.findAll().filter { it.courseId == courseId &&
                    (includeDrafts || it.status == PostStatus.PUBLISHED && it.visibility == PostVisibility.PUBLIC) }
            }
            else -> posts.findAll().filter { includeDrafts ||
                it.status == PostStatus.PUBLISHED && it.visibility == PostVisibility.PUBLIC }
        }
        val result = selected.map { post ->
            val id = post.id ?: error("Persisted post has no ID")
            val body = markdown.readPost(post)
            ExportDocument("posts", id, post.slug, body,
                mapOf("id" to id, "title" to post.title, "slug" to post.slug, "section" to post.section.name,
                    "status" to post.status.name, "publishedAt" to post.publishedAt?.toString(),
                    "visibility" to post.visibility.name, "bodySha256" to PostBodyHash.sha256(body),
                    "createdAt" to post.createdAt.toString(), "updatedAt" to post.updatedAt.toString(),
                    "categoryId" to post.categoryId, "projectId" to post.projectId,
                    "relatedProjectId" to post.relatedProjectId, "documentOrder" to post.documentOrder,
                    "courseId" to post.courseId, "chapterOrder" to post.chapterOrder,
                    "techSeriesOrder" to post.techSeriesOrder, "summary" to post.summary,
                    "tags" to postTags.findNamesByPostId(id), "wikiTargets" to postWikiLinks.findTitles(id),
                    "project" to post.projectId?.let(::projectMetadata),
                    "course" to post.courseId?.let(::courseMetadata)),
                assets(postAttachments.findIdsByPostId(id)))
        }.toMutableList()
        val selectedDrafts = if (!includeDrafts) emptyList() else when {
            postId != null -> listOfNotNull(drafts.findByPostId(postId))
            projectId != null -> drafts.findAll().filter { it.projectId == projectId }
            courseId != null -> drafts.findAll().filter { it.courseId == courseId }
            else -> drafts.findAll()
        }
        result += selectedDrafts.map { draft ->
            val id = draft.id ?: error("Persisted editor draft has no ID")
            ExportDocument("drafts", id, draft.slug, markdown.readDraft(id),
                mapOf("id" to id, "postId" to draft.postId, "title" to draft.title,
                    "slug" to draft.slug, "section" to draft.section.name, "revision" to draft.revision,
                    "visibility" to draft.visibility.name, "baseUpdatedAt" to draft.baseUpdatedAt?.toString(),
                    "createdAt" to draft.createdAt.toString(), "updatedAt" to draft.updatedAt.toString(),
                    "categoryId" to draft.categoryId, "projectId" to draft.projectId,
                    "relatedProjectId" to draft.relatedProjectId, "documentOrder" to draft.documentOrder,
                    "courseId" to draft.courseId, "chapterOrder" to draft.chapterOrder,
                    "techSeriesOrder" to draft.techSeriesOrder, "summary" to draft.summary,
                    "tags" to draft.tags(), "wikiTargets" to draftWikiLinks.findTitles(id),
                    "projectMetadata" to draft.projectMetadata(),
                    "project" to draft.projectId?.let(::projectMetadata),
                    "course" to draft.courseId?.let(::courseMetadata)),
                assets(draftAttachments.findIdsByDraftId(id)))
        }
        if (result.any { it.assets.isNotEmpty() }) storage.requireConfigured()
        if (result.size > 2000 || result.sumOf { it.body.toByteArray(Charsets.UTF_8).size.toLong() +
            it.assets.sumOf(ExportAsset::byteSize) } > MAX_RAW_BYTES) throw exportTooLarge()
        result.forEach { portableMarkdown(it.body, it.assets) }
        return result
    }

    /** 모든 로컬 첨부를 검증한 제한 크기 ZIP을 비공개 임시 파일에 완성. */
    fun prepare(documents: List<ExportDocument>): ExportArchive {
        val path = Files.createTempFile("ken-blog-export-", ".zip")
        try {
            Files.setPosixFilePermissions(path, setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE))
            Files.newOutputStream(path).use { output -> write(documents, BoundedOutputStream(output, MAX_ARCHIVE_BYTES)) }
            return ExportArchive(path, Files.size(path))
        } catch (ex: Exception) {
            Files.deleteIfExists(path)
            throw ex
        }
    }

    /** 로컬 파일은 장기 DB 트랜잭션 없이 각 ZIP 항목으로 복사. */
    fun write(documents: List<ExportDocument>, output: OutputStream) {
        val deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(10)
        ZipOutputStream(output).use { zip ->
            documents.forEach { document ->
                if (System.nanoTime() > deadline) throw ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "내보내기 시간이 초과됐습니다.")
                val prefix = "${document.kind}/${document.id}-${safeName(document.slug)}/"
                val portable = portableMarkdownWithMetadata(document.body, document.assets)
                entry(zip, "${prefix}original.md", document.body.toByteArray(Charsets.UTF_8))
                entry(zip, "${prefix}post.md", portable.markdown.toByteArray(Charsets.UTF_8))
                entry(zip, "${prefix}metadata.json", mapper.writeValueAsBytes(document.metadata +
                    ("imagePairs" to portable.imagePairs)))
                entry(zip, "${prefix}attachments.json", mapper.writeValueAsBytes(document.assets.map { asset ->
                    mapOf("id" to asset.id, "originalFilename" to asset.originalFilename,
                        "relativePath" to asset.relativePath, "contentType" to asset.contentType)
                }))
                document.assets.forEach { asset ->
                    zip.putNextEntry(ZipEntry(prefix + asset.relativePath))
                    storage.open(asset.objectKey).use { input ->
                        val buffer = ByteArray(64 * 1024)
                        var count = 0L
                        while (true) {
                            if (System.nanoTime() > deadline) throw ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "내보내기 시간이 초과됐습니다.")
                            val size = input.read(buffer)
                            if (size < 0) break
                            count += size
                            if (count > asset.byteSize) throw ResponseStatusException(HttpStatus.CONFLICT, "첨부 원본 크기가 변경됐습니다.")
                            zip.write(buffer, 0, size)
                        }
                        if (count != asset.byteSize) throw ResponseStatusException(HttpStatus.CONFLICT, "첨부 원본 크기가 변경됐습니다.")
                    }
                    zip.closeEntry()
                }
            }
        }
    }

    private fun assets(ids: List<Long>): List<ExportAsset> = ids.map { id ->
        val asset = attachments.findByIdOrNull(id)
            ?: throw ResponseStatusException(HttpStatus.CONFLICT, "첨부 원본을 찾을 수 없습니다.")
        if (asset.status != AttachmentStatus.READY)
            throw ResponseStatusException(HttpStatus.CONFLICT, "첨부가 처리 중입니다.")
        val extension = when (asset.contentType) {
            "image/png" -> "png"
            "image/jpeg" -> "jpg"
            else -> throw ResponseStatusException(HttpStatus.CONFLICT, "지원하지 않는 첨부 형식입니다.")
        }
        ExportAsset(id, asset.originalFilename, asset.contentType, "assets/$id.$extension", asset.objectKey, asset.byteSize)
    }

    /** 원고와 함께 복원할 부모 프로젝트의 현재 메타데이터. */
    private fun projectMetadata(id: Long): Map<String, Any?>? = projects.findByIdOrNull(id)?.let { project ->
        mapOf("id" to id, "slug" to project.slug, "name" to project.name, "status" to project.status.name,
            "startPeriod" to project.startPeriod, "endPeriod" to project.endPeriod,
            "overview" to project.overview, "visibility" to project.visibility.name,
            "sortOrder" to project.sortOrder, "homePostId" to project.homePostId,
            "createdAt" to project.createdAt.toString(), "updatedAt" to project.updatedAt.toString())
    }

    /** 회차 원고와 함께 복원할 Notes 과목의 현재 메타데이터. */
    private fun courseMetadata(id: Long): Map<String, Any?>? = courses.findByIdOrNull(id)?.let { course ->
        mapOf("id" to id, "slug" to course.slug, "field" to course.field, "name" to course.name,
            "description" to course.description, "status" to course.status.name,
            "createdAt" to course.createdAt.toString(), "updatedAt" to course.updatedAt.toString())
    }

    private fun entry(zip: ZipOutputStream, path: String, bytes: ByteArray) {
        zip.putNextEntry(ZipEntry(path))
        zip.write(bytes)
        zip.closeEntry()
    }

    private fun safeName(raw: String): String = raw.lowercase().replace(Regex("[^a-z0-9-]"), "-")
        .trim('-').take(80).ifEmpty { "document" }

    private fun exportTooLarge() = ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "내보내기 크기 제한을 넘었습니다.")

    private companion object {
        const val MAX_RAW_BYTES = 512L * 1024 * 1024
        const val MAX_ARCHIVE_BYTES = 512L * 1024 * 1024
    }
}

/** DB 조회가 끝난 뒤에도 필요한 값만 보존하는 ZIP 항목. */
data class ExportDocument(val kind: String, val id: Long, val slug: String, val body: String,
    val metadata: Map<String, Any?>, val assets: List<ExportAsset>)

data class ExportAsset(val id: Long, val originalFilename: String, val contentType: String,
    val relativePath: String, val objectKey: String, val byteSize: Long)

/** 휴대용 Markdown의 한 다크 이미지와 원본 첨부의 선택 관계. */
data class ExportImagePair(val lightAttachmentId: Long?, val lightSource: String,
    val lightRelativePath: String?, val darkAttachmentId: Long, val darkRelativePath: String,
    val width: Int, val align: String)

/** 한 번의 이미지 AST 순회에서 만든 Markdown과 dark 쌍 메타데이터. */
internal data class PortableMarkdownResult(val markdown: String, val imagePairs: List<ExportImagePair>)

/** HTTP 응답이 끝나거나 중단되면 임시 ZIP을 항상 정리. */
data class ExportArchive(val path: Path, val length: Long) {
    fun copyTo(output: OutputStream) {
        try { Files.newInputStream(path).use { it.copyTo(output) } }
        finally { Files.deleteIfExists(path) }
    }
}

/** 압축 후에도 디스크 용량 상한을 넘지 않는 출력 스트림. */
private class BoundedOutputStream(private val delegate: OutputStream, private val limit: Long) : OutputStream() {
    private var written = 0L
    override fun write(value: Int) { count(1); delegate.write(value) }
    override fun write(bytes: ByteArray, offset: Int, length: Int) { count(length); delegate.write(bytes, offset, length) }
    override fun flush() = delegate.flush()
    override fun close() = delegate.close()
    private fun count(bytes: Int) {
        written += bytes
        if (written > limit) throw ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "내보내기 크기 제한을 넘었습니다.")
    }
}

/** Markdown AST에서 실제 이미지 노드만 교체하고 미사용 참조 정의·일반 링크는 보존. */
internal fun portableMarkdown(source: String, assets: List<ExportAsset>): String =
    portableMarkdownWithMetadata(source, assets).markdown

/** 실제 이미지 AST를 한 번 순회하면서 상대 경로와 다크 이미지 쌍을 함께 수집. */
internal fun portableMarkdownWithMetadata(source: String, assets: List<ExportAsset>): PortableMarkdownResult {
    val paths = assets.associate { it.id.toString() to it.relativePath }
    val parser = Parser.builder().includeSourceSpans(IncludeSourceSpans.BLOCKS_AND_INLINES).build()
    val document = parser.parse(source)
    val excluded = exportLiteralRanges(source)
    val edits = mutableListOf<MarkdownEdit>()
    val imagePairs = mutableListOf<ExportImagePair>()
    val attachment = Regex("^attachment:([1-9][0-9]*)$")
    val dark = Regex("^([\\s\\S]*)\\|dark=([1-9][0-9]*)\\|w=(20|[2-9][0-9]|100)\\|a=(left|center|right)$")

    fun path(id: String): String = paths[id]
        ?: throw ResponseStatusException(HttpStatus.CONFLICT, "본문이 참조한 첨부가 연결되지 않았습니다.")

    fun visit(node: Node) {
        val spans = node.sourceSpans
        if (node is Image && spans.isNotEmpty()) {
            // 여러 줄 이미지의 SourceSpan은 줄마다 나뉘므로 첫/마지막 절대 위치를 사용.
            val from = spans.first().inputIndex
            val to = spans.last().let { it.inputIndex + it.length }
            if (from >= 0 && to <= source.length && excluded.none { from < it.end && to > it.start }) {
                val raw = source.substring(from, to)
                val altEnd = markdownImageAltEnd(raw)
                if (altEnd != null) {
                    val rawAlt = raw.substring(2, altEnd)
                    val darkMatch = dark.matchEntire(rawAlt)?.takeUnless { it.groupValues[1].contains("|dark=") }
                    val id = node.destination?.let { attachment.matchEntire(it)?.groupValues?.get(1) }
                    val alt = if (darkMatch == null) raw.substring(0, altEnd + 1) else
                        "![${darkMatch.groupValues[1]}|dark=${path(darkMatch.groupValues[2])}" +
                            "|w=${darkMatch.groupValues[3]}|a=${darkMatch.groupValues[4]}]"
                    if (darkMatch != null) {
                        val lightPath = id?.let(::path)
                        imagePairs += ExportImagePair(id?.toLong(), node.destination.orEmpty(), lightPath,
                            darkMatch.groupValues[2].toLong(), path(darkMatch.groupValues[2]),
                            darkMatch.groupValues[3].toInt(), darkMatch.groupValues[4])
                    }
                    val suffix = raw.substring(altEnd + 1)
                    val updatedSuffix = if (id == null) suffix else {
                        val literal = "attachment:$id"
                        if (suffix.startsWith('(') && literal in suffix) suffix.replaceFirst(literal, path(id))
                        else {
                            // 참조 이미지만 인라인 목적지로 바꿔 미사용 정의와 일반 링크를 건드리지 않음.
                            val title = node.title?.takeIf(String::isNotEmpty)?.let {
                                " \"${it.replace("\\", "\\\\").replace("\"", "\\\"")}\""
                            }.orEmpty()
                            "(${path(id)}$title)"
                        }
                    }
                    val replacement = alt + updatedSuffix
                    if (replacement != raw) edits += MarkdownEdit(from, to, replacement)
                }
            }
        }
        // 이미지 안쪽 text node는 독립 이미지가 아니므로 중복 수정하지 않음.
        if (node is Image) return
        var child = node.firstChild
        while (child != null) {
            visit(child)
            child = child.next
        }
    }
    visit(document)
    val result = StringBuilder(source)
    var lastStart = source.length
    for (edit in edits.sortedByDescending { it.start }) {
        if (edit.end > lastStart) throw ResponseStatusException(HttpStatus.CONFLICT, "첨부 문법이 겹칩니다.")
        result.replace(edit.start, edit.end, edit.value)
        lastStart = edit.start
    }
    return PortableMarkdownResult(result.toString(), imagePairs)
}

/** 이스케이프와 중첩 대괄호를 고려해 이미지 설명의 닫는 위치를 찾음. */
private fun markdownImageAltEnd(raw: String): Int? {
    if (!raw.startsWith("![")) return null
    var depth = 1
    var index = 2
    while (index < raw.length) {
        when (raw[index]) {
            '\\' -> { index += 2; continue }
            '[' -> depth++
            ']' -> { depth--; if (depth == 0) return index }
        }
        index++
    }
    return null
}

private data class MarkdownEdit(val start: Int, val end: Int, val value: String)

/** CommonMark 코어 밖의 KaTeX·raw code 영역은 참조 수정 대상에서 제외. */
private fun exportLiteralRanges(source: String): List<MarkdownRange> {
    val ranges = mutableListOf<MarkdownRange>()
    Regex("(?is)<(?:pre|code)\\b[^>]*>.*?</(?:pre|code)\\s*>").findAll(source).forEach {
        ranges += MarkdownRange(it.range.first, it.range.last + 1)
    }
    val blockMarker = Regex("^ {0,3}\\$\\$[ \\t]*\\r?$")
    var lineStart = 0
    var blockStart: Int? = null
    for (line in source.splitToSequence('\n')) {
        val lineEnd = lineStart + line.length
        if (blockMarker.matches(line)) {
            if (blockStart == null) blockStart = lineStart
            else {
                ranges += MarkdownRange(blockStart, lineEnd + 1)
                blockStart = null
            }
        } else if (blockStart == null) {
            var cursor = lineStart
            while (cursor < lineEnd) {
                if (source[cursor] != '$' || escapedDollar(source, cursor) || cursor + 1 >= lineEnd ||
                    source[cursor + 1].isWhitespace() || source[cursor + 1] == '$') { cursor++; continue }
                var closing = cursor + 1
                while (closing < lineEnd && (source[closing] != '$' || escapedDollar(source, closing) ||
                    source[closing - 1].isWhitespace())) closing++
                if (closing < lineEnd) {
                    ranges += MarkdownRange(cursor, closing + 1)
                    cursor = closing + 1
                } else cursor++
            }
        }
        lineStart = lineEnd + 1
    }
    if (blockStart != null) ranges += MarkdownRange(blockStart, source.length)
    return ranges
}

private fun escapedDollar(source: String, index: Int): Boolean {
    var escapes = 0
    var cursor = index - 1
    while (cursor >= 0 && source[cursor] == '\\') { escapes++; cursor-- }
    return escapes % 2 == 1
}

private data class MarkdownRange(val start: Int, val end: Int)
