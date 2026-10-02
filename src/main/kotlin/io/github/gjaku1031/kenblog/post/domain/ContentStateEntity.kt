package io.github.gjaku1031.kenblog.post.domain

import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table

/**
 * 분류와 프로젝트 집합 변경을 직렬화하는 기존 단일 DB 잠금 행
 */
@Entity
@Table(name = "content_state")
class ContentStateEntity protected constructor() {
    /**
     * ID
     */
    @Id
    var id: Byte = 1
        protected set
}
