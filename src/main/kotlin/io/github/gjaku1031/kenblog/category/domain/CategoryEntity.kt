package io.github.gjaku1031.kenblog.category.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.FetchType
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint

/** FK로 부모를 참조하고 정규화 경로를 독립적으로 보존하는 Tech 분류 행. */
@Entity
@Table(name = "categories", uniqueConstraints = [
    UniqueConstraint(name = "uk_categories_path", columnNames = ["path"]),
])
class CategoryEntity protected constructor() {
    // DB 외래 키와 삭제 규칙. 저장은 기존 ID 필드를 사용.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id", insertable = false, updatable = false)
    private var parent: CategoryEntity? = null

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(name = "parent_id")
    var parentId: Long? = null
        protected set

    @Column(nullable = false, length = 256, columnDefinition = "varchar(256) character set utf8mb4 collate utf8mb4_bin")
    lateinit var path: String
        protected set

    @Column(nullable = false, length = 60)
    lateinit var name: String
        protected set

    @Column(nullable = false)
    var depth: Int = 0
        protected set

    @Column(name = "sort_order", nullable = false)
    var sortOrder: Int = 0
        protected set

    /**
     * 검증·정규화된 새 분류를 FK 부모 아래 생성.
     *
     * @param parentId 기존 부모 또는 대분류의 `null`
     * @param path 중복되지 않는 전체 경로
     * @param name 표시 이름
     * @param depth 1~3 깊이
     * @param sortOrder 같은 부모의 마지막에 배치할 양수 순서
     */
    internal constructor(parentId: Long?, path: String, name: String, depth: Int, sortOrder: Int) : this() {
        this.parentId = parentId
        this.path = path
        this.name = name
        this.depth = depth
        this.sortOrder = sortOrder
    }

    /** 같은 부모의 숫자 순서만 바꾸며 경로와 자손은 유지. */
    internal fun reorder(order: Int) { sortOrder = order }

}
