package io.github.gjaku1031.kenblog.note.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime

/** Notes 과목의 진행 상태. */
enum class CourseStatus { IN_PROGRESS, COMPLETED }

/** 회차 본문과 분리해 과목 소개 및 분야를 저장하는 행. */
@Entity
@Table(name = "courses")
class CourseEntity protected constructor() {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(nullable = false, length = 160, unique = true)
    lateinit var slug: String
        protected set

    @Column(nullable = false, length = 100)
    lateinit var field: String
        protected set

    @Column(nullable = false, length = 200)
    lateinit var name: String
        protected set

    @Column(nullable = false, length = 500)
    lateinit var description: String
        protected set

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    var status: CourseStatus = CourseStatus.IN_PROGRESS
        protected set

    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var createdAt: LocalDateTime
        protected set

    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var updatedAt: LocalDateTime
        protected set

    /** [replace]와 동일한 정규화 값으로 과목을 생성. */
    internal constructor(slug: String, field: String, name: String, description: String,
        status: CourseStatus, now: LocalDateTime) : this() {
        replace(slug, field, name, description, status, now)
        createdAt = now
    }

    /** 관리자 수정에서 소개 속성과 수정 시각을 원자적으로 교체. */
    internal fun replace(slug: String, field: String, name: String, description: String,
        status: CourseStatus, now: LocalDateTime) {
        this.slug = slug
        this.field = field
        this.name = name
        this.description = description
        this.status = status
        updatedAt = now
    }
}
