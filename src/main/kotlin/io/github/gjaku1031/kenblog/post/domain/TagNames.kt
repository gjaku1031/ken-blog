package io.github.gjaku1031.kenblog.post.domain

import java.util.Locale

/** 게시글 태그와 공개 필터에 동일한 Unicode 길이·정규화 계약을 적용. */
object TagNames {
    /** [normalize]로 대소문자 무관 중복을 판정하면서 첫 입력의 표시 철자를 보존. */
    fun displayAll(rawNames: List<String>): List<String> {
        val names = LinkedHashMap<String, String>()
        for (raw in rawNames) {
            val display = raw.trim()
            val canonical = normalize(display)
            if (display.codePointCount(0, display.length) !in 1..40) throw InvalidPostRequestException()
            names.putIfAbsent(canonical, display)
            if (names.size > 16) throw InvalidPostRequestException()
        }
        return names.values.toList()
    }
    /**
     * 앞뒤 공백 제거·ROOT 소문자화 후 1~40 Unicode 문자 및 제어 문자 금지를 확인.
     *
     * @param raw 원본 태그명
     * @return 정규화된 정확 일치 태그명
     * @throws InvalidPostRequestException 빈 값·제어 문자·길이 위반일 때
     */
    fun normalize(raw: String): String {
        if (raw.any { Character.isISOControl(it) }) throw InvalidPostRequestException()
        val name = raw.trim().lowercase(Locale.ROOT)
        if (name.isBlank() || name.codePointCount(0, name.length) !in 1..40) throw InvalidPostRequestException()
        return name
    }

}
