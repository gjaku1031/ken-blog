package io.github.gjaku1031.kenblog.category.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table

/** FK로 부모를 참조하고 정규화 경로를 독립적으로 보존하는 Tech 분류 행. */
@Entity
@Table(name = "categories")
class CategoryEntity protected constructor() {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(name = "parent_id")
    var parentId: Long? = null
        protected set

    @Column(nullable = false, length = 256)
    lateinit var path: String
        protected set

    @Column(nullable = false, length = 60)
    lateinit var name: String
        protected set

    @Column(nullable = false)
    var depth: Int = 0
        protected set

    /**
     * 검증·정규화된 새 분류를 FK 부모 아래 생성.
     *
     * @param parentId 기존 부모 또는 대분류의 `null`
     * @param path 중복되지 않는 전체 경로
     * @param name 표시 이름
     * @param depth 1~3 깊이
     */
    internal constructor(parentId: Long?, path: String, name: String, depth: Int) : this() {
        this.parentId = parentId
        this.path = path
        this.name = name
        this.depth = depth
    }
}
