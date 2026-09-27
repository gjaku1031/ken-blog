package io.github.gjaku1031.kenblog.post.domain

import java.util.UUID

/** 게시 위치별 ASCII 공개 주소를 발급하고 이전 편집본의 자동 발급 주소만 승계. */
object ContentAddress {
    /** @return 제목과 무관한 종류 접두사와 UUID를 가진 새 주소. */
    fun create(section: PostSection): String = "${prefix(section)}-${UUID.randomUUID()}"

    /** @return 새 편집본 주소를 유지하거나 구 편집본의 수동·빈 주소를 새 주소로 교체. */
    fun publishDraft(saved: String, section: PostSection): String =
        if (saved.startsWith("${prefix(section)}-") && UUID_SUFFIX.matches(saved.substringAfter("${prefix(section)}-")))
            saved else create(section)

    /** @return 과목의 독립 공개 주소. */
    fun createCourse(): String = "course-${UUID.randomUUID()}"

    /** @return [PostSection]이 쓰는 공개 주소 접두사. */
    private fun prefix(section: PostSection): String = when (section) {
        PostSection.TECH -> "post"
        PostSection.PROJECT_HOME -> "project"
        PostSection.PROJECT_DOC -> "doc"
        PostSection.NOTE_CHAPTER -> "chapter"
    }

    private val UUID_SUFFIX = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
}
