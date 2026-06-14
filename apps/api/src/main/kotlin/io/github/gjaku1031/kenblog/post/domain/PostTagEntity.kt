package io.github.gjaku1031.kenblog.post.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table

/** 한 게시글의 정규화 태그 한 개와 입력 순서를 저장하는 FK 행. */
@Entity
@Table(name = "post_tags")
class PostTagEntity protected constructor() {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(name = "post_id", nullable = false)
    var postId: Long = 0
        protected set

    @Column(nullable = false)
    var position: Int = 0
        protected set

    @Column(name = "tag_name", nullable = false, length = 40)
    lateinit var name: String
        protected set

    /**
     * 검증한 이름을 지정 게시글의 0 기반 위치에 놓음.
     *
     * @param postId 잠근 게시글의 ID
     * @param position 정규화·중복 제거 후 위치
     * @param name 정규화된 태그명
     */
    internal constructor(postId: Long, position: Int, name: String) : this() {
        this.postId = postId
        this.position = position
        this.name = name
    }
}
