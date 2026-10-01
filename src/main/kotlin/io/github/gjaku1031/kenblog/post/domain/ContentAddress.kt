package io.github.gjaku1031.kenblog.post.domain

import java.util.UUID

/** 과목의 독립 ASCII 공개 주소를 발급한다. 게시글 주소는 등록 시 직접 정한다. */
object ContentAddress {
    /** @return 과목의 독립 공개 주소. */
    fun createCourse(): String = "course-${UUID.randomUUID()}"
}
