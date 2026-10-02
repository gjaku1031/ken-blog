package io.github.gjaku1031.kenblog.mcp.authoring

import io.github.gjaku1031.kenblog.global.error.BusinessException
import io.github.gjaku1031.kenblog.post.dto.WikiDeclarations
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component

/** 본문에서 확실하게 읽은 선언과 문법 범위의 신뢰도를 구분한 결과. */
data class McpBodyInspection(
    val candidateAttachmentIds: List<Long>,
    val candidateWikiTargets: List<String>,
    val complete: Boolean,
    val diagnostics: List<String>,
)

/**
 * MCP 작성 도구의 선언 배열을 점검한다.
 *
 * 브라우저의 remark/GFM 파서와 다른 서버 정규식으로 복잡한 문서를 완전 분석했다고
 * 주장하지 않음. 단순 본문에서는 두 선언의 일치를 강제하고, 나머지는 작성자에게
 * [McpBodyInspection.complete]와 진단을 돌려주어 별도 배열을 직접 확인하게 함.
 */
@Component
class McpBodyDeclarations {
    /**
     * 줄 단위의 보수적 후보 탐색. 독립 이미지의 기본·다크 첨부를 함께 세고,
     * fenced code와 블록 수식 안의 가짜 참조는 제외.
     *
     * @return 확실한 후보와 완전성; 복잡 문법의 후보는 권위 있는 전체 목록이 아님
     */
    fun inspect(body: String): McpBodyInspection {
        val images = sortedSetOf<Long>()
        val wiki = linkedSetOf<String>()
        val diagnostics = linkedSetOf<String>()
        var fence: Pair<Char, Int>? = null
        var math = false
        for (line in body.lineSequence()) {
            val source = line.removeSuffix("\r")
            val marker = FENCE.find(source)
            if (fence != null) {
                diagnostics.add("코드 펜스가 있어 본문 선언을 완전 추출하지 않았습니다.")
                if (marker != null && marker.groupValues[1].first() == fence.first &&
                    marker.groupValues[1].length >= fence.second && marker.groupValues[2].isBlank()) fence = null
                continue
            }
            if (marker != null) {
                fence = marker.groupValues[1].first() to marker.groupValues[1].length
                diagnostics.add("코드 펜스가 있어 본문 선언을 완전 추출하지 않았습니다.")
                continue
            }
            if (MATH_DELIMITER.matches(source)) {
                math = !math
                diagnostics.add("수식 블록이 있어 본문 선언을 완전 추출하지 않았습니다.")
                continue
            }
            if (math) continue
            if (source.isBlank()) continue
            val trimmed = source.trim()
            if (source.startsWith("    ") || source.startsWith("\t") ||
                source.contains('`') || source.contains('$') || source.contains('<') ||
                source.contains("[*") || source.contains('\\')) {
                diagnostics.add("인라인 코드·수식·주석·HTML·이스케이프 또는 들여쓴 코드가 있어 별도 선언 확인이 필요합니다.")
                continue
            }
            val image = IMAGE.matchEntire(trimmed)
            if (image != null) {
                val alt = image.groupValues[1]
                val id = safeAttachmentId(image.groupValues[2])
                val metadata = if ('|' in alt) IMAGE_ALT.matchEntire(alt) else null
                val darkText = metadata?.groupValues?.get(2).orEmpty()
                val darkId = darkText.takeIf { it.isNotEmpty() }?.let(::safeAttachmentId)
                if (id != null && ('|' !in alt || metadata != null) &&
                    (darkText.isEmpty() || darkId != null)) {
                    images.add(id)
                    if (darkId != null) images.add(darkId)
                } else diagnostics.add("이미지 설명·다크 첨부·너비·정렬 또는 첨부 ID를 확인할 수 없습니다.")
                continue
            }
            if (source.contains("![") || source.contains("](") ||
                REFERENCE_DEFINITION.matches(source) || source.contains('|') && !source.contains("[[")) {
                diagnostics.add("인라인·참조 이미지, 일반 링크 또는 표가 있어 별도 선언 확인이 필요합니다.")
                continue
            }
            val matches = WIKI.findAll(source).toList()
            var remainder = source
            for (match in matches) {
                val title = match.groupValues[1].trim()
                val label = match.groupValues[2].ifEmpty { title }.trim()
                val validTitle = runCatching { WikiDeclarations.title(title) }.getOrNull()
                if (validTitle == title && label.isNotEmpty() && label.codePointCount(0, label.length) <= 2048 &&
                    !label.any { it == '[' || it == ']' || Character.isISOControl(it) }) wiki.add(title)
                else diagnostics.add("위키 링크 제목 또는 표시 이름을 확인할 수 없습니다.")
                remainder = remainder.replaceFirst(match.value, "")
            }
            if (remainder.contains("[[") || remainder.contains("[*") ||
                remainder.contains('[') || remainder.contains(']') || remainder.contains('|')) {
                diagnostics.add("위키·주석·링크 또는 표의 모호한 문법이 있어 별도 선언 확인이 필요합니다.")
            }
        }
        if (fence != null || math) diagnostics.add("닫히지 않은 코드 또는 수식 블록이 있습니다.")
        if (images.size > 100) diagnostics.add("표시 가능한 첨부 이미지가 100개를 넘습니다.")
        if (wiki.size > 128) diagnostics.add("위키 대상 제목이 128개를 넘습니다.")
        if (body.toByteArray(Charsets.UTF_8).size > 1024 * 1024) diagnostics.add("본문이 저장 크기 1 MiB를 넘습니다.")
        return McpBodyInspection(images.take(100), wiki.take(128), diagnostics.isEmpty(), diagnostics.toList())
    }

    /**
     * 명시 선언의 형식과 완전 분석 가능한 본문의 일치를 검증.
     *
     * @throws BusinessException 잘못된 선언 또는 단순 본문의 불일치를 나타내는 안전한 400
     */
    fun validate(body: String, attachmentIds: List<Long>, wikiTargets: List<String>): McpBodyInspection {
        if (declarationDiagnostics(attachmentIds, wikiTargets).isNotEmpty()) invalid()
        val inspection = inspect(body)
        if (inspection.complete && (inspection.candidateAttachmentIds != attachmentIds.sorted() ||
            inspection.candidateWikiTargets != wikiTargets)) invalid()
        return inspection
    }

    /** 입력 원문을 노출하지 않고 명시 배열의 크기·중복·형식을 설명. */
    fun declarationDiagnostics(attachmentIds: List<Long>, wikiTargets: List<String>): List<String> = buildList {
        if (attachmentIds.size > 100 || attachmentIds.any { it !in 1..MAX_SAFE_ATTACHMENT_ID } ||
            attachmentIds.distinct().size != attachmentIds.size) add("attachmentIds는 중복 없는 양수 안전 정수 ID 최대 100개여야 합니다.")
        if (wikiTargets.size > 128 || wikiTargets.distinct().size != wikiTargets.size ||
            wikiTargets.any { runCatching { WikiDeclarations.title(it) }.getOrNull() != it })
            add("wikiTargets는 정규화된 고유 제목 최대 128개여야 합니다.")
    }

    /** 선언 오류의 입력 원문을 응답에 싣지 않는 400. */
    private fun invalid(): Nothing = throw BusinessException(HttpStatus.BAD_REQUEST,
        "본문과 첨부·위키 선언을 확인하세요.")

    /** 웹의 `Number.isSafeInteger`와 같은 양수 첨부 ID 범위만 수용. */
    private fun safeAttachmentId(value: String): Long? =
        value.toLongOrNull()?.takeIf { it in 1..MAX_SAFE_ATTACHMENT_ID }

    private companion object {
        const val MAX_SAFE_ATTACHMENT_ID = 9_007_199_254_740_991L
        val FENCE = Regex("^ {0,3}(`{3,}|~{3,})(.*)$")
        val MATH_DELIMITER = Regex("^ {0,3}\\$\\$[ \\t]*$")
        val IMAGE = Regex("^!\\[([^\\]\\r\\n]*)\\](?:\\(attachment:([1-9][0-9]*)\\))$")
        val IMAGE_ALT = Regex("^([^|]*)\\|(?:dark=([1-9][0-9]*)\\|)?w=(20|[2-9][0-9]|100)\\|a=(left|center|right)$")
        val WIKI = Regex("\\[\\[([^\\[\\]\\|\\r\\n]+)(?:\\|([^\\[\\]\\|\\r\\n]+))?\\]\\]")
        val REFERENCE_DEFINITION = Regex("^ {0,3}\\[[^]]+]:.*$")
    }
}
