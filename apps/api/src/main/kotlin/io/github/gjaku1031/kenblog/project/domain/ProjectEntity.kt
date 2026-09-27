package io.github.gjaku1031.kenblog.project.domain

import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime

/** 프로젝트 진행 단계를 공개 카드에 표시하는 값. */
enum class ProjectStatus { PLAN, DEV, MAINT, DONE }

/** 공개 대문 속성을 저장하며 본문은 PROJECT_HOME 게시글에서 관리하는 행. */
@Entity
@Table(name = "projects")
class ProjectEntity protected constructor() {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    @Column(nullable = false, length = 160, unique = true)
    lateinit var slug: String
        protected set

    @Column(nullable = false, length = 200)
    lateinit var name: String
        protected set

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    var status: ProjectStatus = ProjectStatus.PLAN
        protected set

    @Column(name = "start_period", nullable = false, length = 7)
    lateinit var startPeriod: String
        protected set

    @Column(name = "end_period", length = 7)
    var endPeriod: String? = null
        protected set

    @Column(nullable = false, length = 500)
    lateinit var overview: String
        protected set

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    var visibility: PostVisibility = PostVisibility.PRIVATE
        protected set

    @Column(name = "home_post_id")
    var homePostId: Long? = null
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

    /** 검증한 새 대문 속성으로 아직 HOME 글이 없는 프로젝트를 생성. */
    internal constructor(slug: String, name: String, values: ProjectMetadata, now: LocalDateTime,
        sortOrder: Long) : this() {
        this.slug = slug
        this.name = name
        this.sortOrder = sortOrder
        replace(values, now)
        this.createdAt = now
    }

    /** 카드 순서만 바꾸며 원고의 [updatedAt]은 유지. */
    internal fun reorder(position: Long) { sortOrder = position }

    /** 공개 대문 출간과 같은 트랜잭션에서 속성과 수정 시각을 교체. */
    internal fun replace(values: ProjectMetadata, now: LocalDateTime) {
        status = values.status
        startPeriod = values.startPeriod
        endPeriod = values.endPeriod
        overview = values.overview
        visibility = values.visibility
        updatedAt = now
    }

    /** [homePostId]의 공개 범위와 함께 변경할 때만 프로젝트 시각을 갱신. */
    internal fun changeVisibility(value: PostVisibility, now: LocalDateTime) {
        if (visibility == value) return
        visibility = value
        updatedAt = now
    }

    /** 프로젝트 이름만 갱신하고 기존 공개 주소를 유지. */
    internal fun rename(name: String, now: LocalDateTime) {
        this.name = name
        updatedAt = now
    }

    /** 새 HOME 글이 저장된 뒤 순환 FK의 나머지 연결을 확정. */
    internal fun attachHome(postId: Long) { homePostId = postId }

    /** 프로젝트 삭제 전 HOME FK를 해제해 순환 참조를 끊음. */
    internal fun detachHome() { homePostId = null }
}

/** 대문 편집본에 보관하는 검증된 프로젝트 메타데이터. */
data class ProjectMetadata(
    val status: ProjectStatus,
    val startPeriod: String,
    val endPeriod: String?,
    val overview: String,
    val visibility: PostVisibility,
    val baseProjectUpdatedAt: LocalDateTime?,
    val stackBadgeNames: List<String> = emptyList(),
)
