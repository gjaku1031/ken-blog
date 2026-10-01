package io.github.gjaku1031.kenblog.series.domain

import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import jakarta.persistence.*
import java.time.LocalDateTime

/** 글 묶음의 탐색 구획. Notes·논문·공부는 TECH 시리즈로 관리. */
enum class SeriesKind { TECH, PROJECT }

/** 프로젝트 시리즈에만 지정하는 진행 상태. */
enum class ProjectStatus { PLAN, DEV, MAINT, DONE }

/** 대문 FK 없이 출간 글의 저장 순서로 첫 문서를 결정하는 시리즈. */
@Entity
@Table(name = "series", uniqueConstraints = [
    UniqueConstraint(name = "uk_series_slug", columnNames = ["slug"]),
    UniqueConstraint(name = "uk_series_legacy", columnNames = ["legacy_source", "legacy_id"]),
])
class SeriesEntity protected constructor() {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set
    @Column(nullable = false, length = 160, columnDefinition = "varchar(160) character set ascii collate ascii_bin")
    lateinit var slug: String
        protected set
    @Column(nullable = false, length = 200)
    lateinit var name: String
        protected set
    @Column(nullable = false, length = 1000)
    var description: String = ""
        protected set
    @Enumerated(EnumType.STRING) @Column(nullable = false, columnDefinition = "varchar(16)")
    lateinit var kind: SeriesKind
        protected set
    @Enumerated(EnumType.STRING) @Column(nullable = false, columnDefinition = "varchar(16)")
    var visibility: PostVisibility = PostVisibility.PUBLIC
        protected set
    @Enumerated(EnumType.STRING) @Column(name = "project_status", columnDefinition = "varchar(16)")
    var projectStatus: ProjectStatus? = null
        protected set
    @Column(name = "start_period", length = 7)
    var startPeriod: String? = null
        protected set
    @Column(name = "end_period", length = 7)
    var endPeriod: String? = null
        protected set
    @Column(name = "sort_order", nullable = false)
    var sortOrder: Long = 0
        protected set
    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var createdAt: LocalDateTime
        protected set
    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var updatedAt: LocalDateTime
        protected set
    // 재실행 가능한 기존 자료 이관과 이전 주소 연결에만 사용하는 출처.
    @Column(name = "legacy_source", length = 16)
    var legacySource: String? = null
        protected set
    @Column(name = "legacy_id")
    var legacyId: Long? = null
        protected set

    internal constructor(slug: String, kind: SeriesKind, name: String, description: String,
        projectStatus: ProjectStatus?, startPeriod: String?, endPeriod: String?, now: LocalDateTime) : this() {
        this.slug = slug
        this.kind = kind
        this.createdAt = now
        replace(name, description, projectStatus, startPeriod, endPeriod, now)
    }

    /** 종류와 공개 주소는 유지하며 시리즈 메타데이터만 변경. */
    internal fun replace(name: String, description: String, projectStatus: ProjectStatus?,
        startPeriod: String?, endPeriod: String?, now: LocalDateTime) {
        this.name = name
        this.description = description
        this.projectStatus = projectStatus
        this.startPeriod = startPeriod
        this.endPeriod = endPeriod
        this.updatedAt = now
    }

    /** 시리즈 카드의 숫자 순서만 변경. */
    internal fun reorder(order: Long) { sortOrder = order }
}
