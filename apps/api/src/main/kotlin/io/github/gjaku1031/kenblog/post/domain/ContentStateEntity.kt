package io.github.gjaku1031.kenblog.post.domain

import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table

/** 핀 전역 순열을 직렬화하는 단일 DB 잠금 행. */
@Entity
@Table(name = "content_state")
class ContentStateEntity protected constructor() {
    @Id
    var id: Byte = 1
        protected set
}
