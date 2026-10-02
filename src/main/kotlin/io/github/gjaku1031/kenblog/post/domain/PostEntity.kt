package io.github.gjaku1031.kenblog.post.domain

import io.github.gjaku1031.kenblog.category.domain.CategoryEntity
import io.github.gjaku1031.kenblog.series.domain.SeriesEntity
import jakarta.persistence.*
import java.time.LocalDateTime
import org.hibernate.annotations.OnDelete
import org.hibernate.annotations.OnDeleteAction

/**
 * 글의 출간 여부
 * 본문은 저장소 Markdown에서만 수정
 */
enum class PostStatus {
    /**
     * 초안
     */
    DRAFT,

    /**
     * 출간
     */
    PUBLISHED
}

/**
 * 기존 비공개 자료를 자동 공개하지 않기 위한 저장 호환 값
 */
enum class PostVisibility {
    /**
     * 공개
     */
    PUBLIC,

    /**
     * 비공개
     */
    PRIVATE
}

/**
 * Tech·프로젝트·공부를 같은 글 모델로 저장하고 시리즈 소속으로 탐색 구획 결정
 */
@Entity
@Table(name = "posts", uniqueConstraints = [UniqueConstraint(name = "uk_posts_slug", columnNames = ["slug"])])
class PostEntity protected constructor() {
    /**
     * 분류 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "category_id", insertable = false, updatable = false)
    private var category: CategoryEntity? = null

    /**
     * 시리즈 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "series_id", insertable = false, updatable = false)
    private var series: SeriesEntity? = null

    /**
     * 관련 프로젝트 시리즈 FK 매핑
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "related_series_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.SET_NULL)
    private var relatedSeries: SeriesEntity? = null

    /**
     * ID
     */
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set

    /**
     * 제목
     */
    @Column(nullable = false, length = 200)
    lateinit var title: String
        protected set

    /**
     * 공개 주소 식별자
     */
    @Column(nullable = false, length = 160, columnDefinition = "varchar(160) character set ascii collate ascii_bin")
    lateinit var slug: String
        protected set
    // 옛 DB 원문과 해시는 복구 자료로 유지하며 신규 등록은 빈 값

    /**
     * 복구·스키마 호환용 이전 본문
     */
    @Column(nullable = false, columnDefinition = "longtext")
    lateinit var body: String
        protected set

    /**
     * 이전 본문의 SHA-256
     */
    @Column(name = "body_sha256", nullable = false, columnDefinition = "char(64)")
    lateinit var bodySha256: String
        protected set

    /**
     * 요약
     */
    @Column(nullable = false, length = 120)
    var summary: String = ""
        protected set

    /**
     * 분류 ID
     */
    @Column(name = "category_id")
    var categoryId: Long? = null
        protected set

    /**
     * 시리즈 ID
     */
    @Column(name = "series_id")
    var seriesId: Long? = null
        protected set

    /**
     * 관련 프로젝트 시리즈 ID
     */
    @Column(name = "related_series_id")
    var relatedSeriesId: Long? = null
        protected set

    /**
     * 시리즈 내 정렬 순서
     */
    @Column(name = "series_order")
    var seriesOrder: Int? = null
        protected set
    // 이전 구획은 이관 때 TECH로 정규화 앱의 종류 판단에는 사용하지 않음

    /**
     * 스키마 호환용 이전 구획
     */
    @Column(name = "section", nullable = false, length = 16)
    private var legacySection: String = "TECH"

    /**
     * 이전 공개 경로
     */
    @Column(name = "legacy_path", length = 500)
    var legacyPath: String? = null
        protected set

    /**
     * 스키마 호환용 이전 고정 순서
     */
    @Column(name = "pin_order")
    private var legacyPinOrder: Int? = null

    /**
     * 스키마 호환용 이전 조회 수
     */
    @Column(name = "view_count", nullable = false)
    private var legacyViewCount: Long = 0

    /**
     * 생성 시각
     */
    @Column(name = "created_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var createdAt: LocalDateTime
        protected set

    /**
     * 수정 시각
     */
    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var updatedAt: LocalDateTime
        protected set

    /**
     * 출간 상태
     */
    @Enumerated(EnumType.STRING) @Column(nullable = false, columnDefinition = "varchar(16)")
    var status: PostStatus = PostStatus.DRAFT
        protected set

    /**
     * 공개 범위
     */
    @Enumerated(EnumType.STRING) @Column(nullable = false, columnDefinition = "varchar(16)")
    var visibility: PostVisibility = PostVisibility.PUBLIC
        protected set

    /**
     * 최초 출간 시각
     */
    @Column(name = "published_at", columnDefinition = "datetime(6)")
    var publishedAt: LocalDateTime? = null
        protected set

    /**
     * 게시글 초기 메타데이터 설정
     */
    internal constructor(title: String, slug: String, body: String, now: LocalDateTime) : this() {
        this.title = title
        this.slug = slug
        this.body = body
        this.bodySha256 = PostBodyHash.sha256(body)
        this.createdAt = now
        this.updatedAt = now
    }

    /**
     * 제목·요약과 수정 시각 변경
     */
    internal fun replaceMetadata(title: String, summary: String, now: LocalDateTime) {
        this.title = title
        this.summary = summary
        this.updatedAt = now
    }

    /**
     * 분류와 수정 시각 변경
     */
    internal fun changeCategory(id: Long?, now: LocalDateTime) { categoryId = id; updatedAt = now }

    /**
     * 시리즈 소속·순서·관련 프로젝트 변경
     */
    internal fun assignSeries(id: Long?, order: Int?, relatedId: Long?, now: LocalDateTime) {
        seriesId = id; seriesOrder = order; relatedSeriesId = relatedId; updatedAt = now
    }

    /**
     * 순서만 바꿔 원고의 수정 시각·해시 보존
     */
    internal fun reorder(order: Int?) { seriesOrder = order }

    /**
     * 공개 출간으로 전환하고 최초 출간 시각 기록
     */
    internal fun publish(visibility: PostVisibility, now: LocalDateTime) {
        if (visibility != PostVisibility.PUBLIC) throw InvalidPostRequestException()
        if (status == PostStatus.PUBLISHED && this.visibility == visibility) return
        if (publishedAt == null) publishedAt = now
        status = PostStatus.PUBLISHED; this.visibility = visibility; updatedAt = now
    }

    /**
     * 초안으로 전환하고 수정 시각 갱신
     */
    internal fun unpublish(now: LocalDateTime) {
        if (status == PostStatus.DRAFT) return
        status = PostStatus.DRAFT; updatedAt = now
    }
}
