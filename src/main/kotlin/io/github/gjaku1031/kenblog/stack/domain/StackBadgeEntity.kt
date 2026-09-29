package io.github.gjaku1031.kenblog.stack.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime

/** OCI PNG 객체와 대소문자 무시 고유 이름을 연결하는 기술 뱃지. */
@Entity
@Table(name = "stack_badges")
class StackBadgeEntity protected constructor() {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(nullable = false, length = 100)
    lateinit var name: String
        protected set

    @Column(name = "name_key", nullable = false, length = 100, unique = true)
    lateinit var nameKey: String
        protected set

    @Column(name = "object_key", nullable = false, length = 255, unique = true)
    lateinit var objectKey: String
        protected set

    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var createdAt: LocalDateTime
        protected set

    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var updatedAt: LocalDateTime
        protected set

    /** 검증된 이름·객체 key로 새 행을 생성. */
    constructor(name: String, nameKey: String, objectKey: String, now: LocalDateTime) : this() {
        this.name = name
        this.nameKey = nameKey
        this.objectKey = objectKey
        createdAt = now
        updatedAt = now
    }

    /** 이름을 바꿔 ID로 연결된 프로젝트의 표기를 함께 변경. */
    fun rename(name: String, nameKey: String, now: LocalDateTime) {
        this.name = name
        this.nameKey = nameKey
        updatedAt = now
    }

    /** 새 PNG key로 교체하고 이전 key를 호출자에게 반환. */
    fun replaceImage(key: String, now: LocalDateTime): String = objectKey.also {
        objectKey = key
        updatedAt = now
    }
}
