package io.github.gjaku1031.kenblog.series.domain

import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import jakarta.persistence.*
import java.time.LocalDateTime

/**
 * 글 묶음의 탐색 구획
 * Notes·논문·공부는 TECH 시리즈로 관리
 */
enum class SeriesKind {
    /**
     * 일반 기술·학습 시리즈
     */
    TECH,

    /**
     * 프로젝트 시리즈
     */
    PROJECT
}

/**
 * 프로젝트 시리즈에만 지정하는 진행 상태
 */
enum class ProjectStatus {
    /**
     * 계획
     */
    PLAN,

    /**
     * 개발 중
     */
    DEV,

    /**
     * 유지보수
     */
    MAINT,

    /**
     * 완료
     */
    DONE
}

/**
 * 대문 FK 없이 출간 글의 저장 순서로 첫 문서를 결정하는 시리즈
 */
@Entity
@Table(name = "series", uniqueConstraints = [
    UniqueConstraint(name = "uk_series_slug", columnNames = ["slug"]),
    UniqueConstraint(name = "uk_series_legacy", columnNames = ["legacy_source", "legacy_id"]),
])
open class SeriesEntity protected constructor() {
    /**
     * ID
     */
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    open var id: Long? = null
        protected set

    /**
     * 공개 주소 식별자
     */
    @Column(nullable = false, length = 160, columnDefinition = "varchar(160) character set ascii collate ascii_bin")
    open lateinit var slug: String
        protected set

    /**
     * 이름
     */
    @Column(nullable = false, length = 200)
    open lateinit var name: String
        protected set

    /**
     * 설명
     */
    @Column(nullable = false, length = 1000)
    open var description: String = ""
        protected set

    /**
     * 시리즈 종류
     */
    @Enumerated(EnumType.STRING) @Column(nullable = false, columnDefinition = "varchar(16)")
    open lateinit var kind: SeriesKind
        protected set

    /**
     * 공개 범위
     */
    @Enumerated(EnumType.STRING) @Column(nullable = false, columnDefinition = "varchar(16)")
    open var visibility: PostVisibility = PostVisibility.PUBLIC
        protected set

    /**
     * 프로젝트 진행 상태
     */
    @Enumerated(EnumType.STRING) @Column(name = "project_status", columnDefinition = "varchar(16)")
    open var projectStatus: ProjectStatus? = null
        protected set

    /**
     * 시작 연월
     */
    @Column(name = "start_period", length = 7)
    open var startPeriod: String? = null
        protected set

    /**
     * 종료 연월
     */
    @Column(name = "end_period", length = 7)
    open var endPeriod: String? = null
        protected set

    /**
     * 정렬 순서
     */
    @Column(name = "sort_order", nullable = false)
    open var sortOrder: Long = 0
        protected set

    /**
     * 생성 시각
     */
    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    open lateinit var createdAt: LocalDateTime
        protected set

    /**
     * 수정 시각
     */
    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    open lateinit var updatedAt: LocalDateTime
        protected set
    // 재실행 가능한 기존 자료 이관과 이전 주소 연결에만 사용하는 출처

    /**
     * 이관 전 자료 종류
     */
    @Column(name = "legacy_source", length = 16)
    open var legacySource: String? = null
        protected set

    /**
     * 이관 전 ID
     */
    @Column(name = "legacy_id")
    open var legacyId: Long? = null
        protected set

    /**
     * 시리즈 초기 속성 설정
     */
    internal constructor(slug: String, kind: SeriesKind, name: String, description: String,
        projectStatus: ProjectStatus?, startPeriod: String?, endPeriod: String?, now: LocalDateTime) : this() {
        this.slug = slug
        this.kind = kind
        this.createdAt = now
        replace(name, description, projectStatus, startPeriod, endPeriod, now)
    }

    /**
     * 종류와 공개 주소는 유지하며 시리즈 메타데이터만 변경
     */
    internal open fun replace(name: String, description: String, projectStatus: ProjectStatus?,
        startPeriod: String?, endPeriod: String?, now: LocalDateTime) {
        this.name = name
        this.description = description
        this.projectStatus = projectStatus
        this.startPeriod = startPeriod
        this.endPeriod = endPeriod
        this.updatedAt = now
    }

    /**
     * 시리즈 카드의 숫자 순서만 변경
     */
    internal open fun reorder(order: Long) { sortOrder = order }
}
