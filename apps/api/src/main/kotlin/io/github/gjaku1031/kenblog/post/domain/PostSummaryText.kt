package io.github.gjaku1031.kenblog.post.domain

/** 출간용 명시 요약이 비었을 때 첫 본문 문장을 안전하게 고르는 변환기. */
object PostSummaryText {
    /** @return 코드·수식·이미지·목록을 제외한 첫 문장의 최대 110자 요약. */
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
            val value = line.replace(Regex("!\\[[^]]*](?:\\([^)]*\\))?"), "")
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
}
