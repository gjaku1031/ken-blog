package io.github.gjaku1031.kenblog.stack.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime

/** 로컬 저장소 PNG 객체와 대소문자 무시 고유 이름을 연결하는 기술 뱃지. */
@Entity
@Table(name = "stack_badges")
class StackBadgeEntity protected constructor() {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(nullable = false, length = 100)
    lateinit var name: String
        protected set

    @Column(name = "name_key", nullable = false, length = 100, unique = true, columnDefinition = "varchar(100) character set utf8mb4 collate utf8mb4_bin")
    lateinit var nameKey: String
        protected set

    @Column(name = "object_key", nullable = false, length = 255, unique = true, columnDefinition = "varchar(255) character set ascii collate ascii_bin")
    lateinit var objectKey: String
        protected set

    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var createdAt: LocalDateTime
        protected set

    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var updatedAt: LocalDateTime
        protected set

}
