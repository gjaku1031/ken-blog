package io.github.gjaku1031.kenblog.post.domain

/** 명시 요약이 비었을 때 [fromBody]로 본문의 첫 표시 문장을 고르는 변환기. */
object PostSummaryText {
    /** [PostSummaryText]가 코드·수식·이미지·목록·주석을 제외한다. @return 첫 문장의 최대 110자 요약. */
    fun fromBody(body: String): String {
        var fenced = false
        var math = false
        for (raw in body.lineSequence()) {
            val line = raw.trim()
            if (line.startsWith("```")) { fenced = !fenced; continue }
            if (line == "$$") { math = !math; continue }
            if (fenced || math || line.isEmpty() || line.startsWith("#") || line.startsWith(">") ||
                line.startsWith("-") || line.startsWith("*") || line.startsWith("+ ") ||
                line.startsWith("![") || line.startsWith("|") || line.startsWith("<") ||
                line.startsWith("[") || line.matches(Regex("[0-9]+\\..*"))) continue
            val value = withoutAnnotations(line).replace(Regex("!\\[[^]]*](?:\\([^)]*\\))?"), "")
                .replace(Regex("\\[([^]]+)]\\([^)]*\\)"), "$1")
                .replace(Regex("\\[\\[([^]|]+)(?:\\|([^]]+))?]]")) { match ->
                    match.groups[2]?.value ?: match.groups[1]?.value.orEmpty()
                }
                .replace(Regex("\\*|`|_"), "")
                .replace(Regex("\\s+"), " ").trim()
            if (value.isNotEmpty()) return if (value.codePointCount(0, value.length) <= 110) value
                else value.substring(0, value.offsetByCodePoints(0, 110))
        }
        return ""
    }

    /** [fromBody]가 `[* 내용]` 및 중첩 대괄호를 포함한 주석 전체를 요약에서 제거한다. */
    private fun withoutAnnotations(line: String): String {
        val output = StringBuilder(line.length)
        var index = 0
        while (index < line.length) {
            if (line[index] == '\\' && index + 1 < line.length) {
                output.append(line, index, index + 2)
                index += 2
                continue
            }
            if (line[index] != '[' || index + 1 >= line.length || line[index + 1] != '*') {
                output.append(line[index])
                index++
                continue
            }
            var depth = 1
            var cursor = index + 2
            while (cursor < line.length && depth > 0) {
                if (line[cursor] == '\\' && cursor + 1 < line.length) {
                    cursor += 2
                    continue
                }
                if (line[cursor] == '[') depth++
                if (line[cursor] == ']') depth--
                cursor++
            }
            if (depth == 0) index = cursor else {
                output.append(line, index, line.length)
                break
            }
        }
        return output.toString()
    }
}
