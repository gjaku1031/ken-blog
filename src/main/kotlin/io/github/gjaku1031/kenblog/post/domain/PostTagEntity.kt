package io.github.gjaku1031.kenblog.post.domain

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
import org.hibernate.annotations.OnDelete
import org.hibernate.annotations.OnDeleteAction

/**
 * [TagNames.normalize]의 검색 키와 입력 대소문자를 보존한 표시 이름을 저장하는 FK 행
 */
@Entity
@Table(name = "post_tags", uniqueConstraints = [
    UniqueConstraint(name = "uk_post_tags_position", columnNames = ["post_id", "position"]),
    UniqueConstraint(name = "uk_post_tags_name", columnNames = ["post_id", "tag_name"]),
])
class PostTagEntity protected constructor() {
    // DB 외래 키와 삭제 규칙 저장은 기존 ID 필드를 사용
    /**
     * 게시글 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private var post: PostEntity? = null

    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    /**
     * 게시글 ID
     */
    @Column(name = "post_id", nullable = false)
    var postId: Long = 0
        protected set

    /**
     * 입력 순서의 0 기반 위치
     */
    @Column(nullable = false)
    var position: Int = 0
        protected set

    /**
     * 이름
     */
    @Column(name = "tag_name", nullable = false, length = 40, columnDefinition = "varchar(40) character set utf8mb4 collate utf8mb4_bin")
    lateinit var name: String
        protected set

    /**
     * 표시 이름
     */
    @Column(name = "display_name", nullable = false, length = 40)
    lateinit var displayName: String
        protected set

    /**
     * 검증한 이름을 지정 게시글의 0 기반 위치에 놓음
     *
     * @param postId 잠근 게시글의 ID
     * @param position 정규화·중복 제거 후 위치
     * @param name 첫 입력의 대소문자를 보존한 표시 이름
     */
    internal constructor(postId: Long, position: Int, name: String) : this() {
        this.postId = postId
        this.position = position
        this.name = TagNames.normalize(name)
        this.displayName = name
    }
}
