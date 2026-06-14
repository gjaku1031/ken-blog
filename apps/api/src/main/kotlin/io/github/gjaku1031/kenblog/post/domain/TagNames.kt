package io.github.gjaku1031.kenblog.post.domain

import java.util.Locale

/** 게시글 태그와 공개 필터에 동일한 Unicode 길이·정규화 계약을 적용. */
object TagNames {
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

    /**
     * 정규화 중복을 제거하고 최초 입력 순서를 보존한 최대 16개 태그를 반환.
     *
     * @param rawNames PATCH에서 받은 문자열 배열
     * @return 0~16개의 정규화된 이름
     * @throws InvalidPostRequestException 태그 수 또는 각 이름이 계약을 벗어날 때
     */
    fun normalizeAll(rawNames: List<String>): List<String> {
        val names = LinkedHashSet<String>()
        for (raw in rawNames) {
            names.add(normalize(raw))
            if (names.size > 16) throw InvalidPostRequestException()
        }
        return names.toList()
    }
}
