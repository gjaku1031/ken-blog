package io.github.gjaku1031.kenblog.stack.domain

import io.github.gjaku1031.kenblog.series.domain.SeriesEntity
import jakarta.persistence.Column
import jakarta.persistence.Embeddable
import jakarta.persistence.EmbeddedId
import jakarta.persistence.Entity
import jakarta.persistence.FetchType
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import java.io.Serializable
import org.hibernate.annotations.OnDelete
import org.hibernate.annotations.OnDeleteAction

/** 프로젝트와 기술 뱃지의 복합 키. */
@Embeddable
data class SeriesStackBadgeId(
    @Column(name = "series_id") var seriesId: Long = 0,
    @Column(name = "badge_id") var badgeId: Long = 0,
) : Serializable

/** 프로젝트 뱃지 선택 순서를 보존하는 연결 행. */
@Entity
@Table(name = "series_stack_badges", uniqueConstraints = [
    UniqueConstraint(name = "uk_series_stack_badges_order", columnNames = ["series_id", "sort_order"]),
])
class SeriesStackBadgeEntity protected constructor() {
    // DB 외래 키와 삭제 규칙. 저장은 기존 ID 필드를 사용.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "series_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private var project: SeriesEntity? = null

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "badge_id", insertable = false, updatable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private var badge: StackBadgeEntity? = null

    @EmbeddedId
    lateinit var id: SeriesStackBadgeId
        protected set

    @Column(name = "sort_order", nullable = false)
    var sortOrder: Int = 0
        protected set

    /** 프로젝트 ID와 이미 등록된 뱃지 ID를 순서대로 연결. */
    constructor(seriesId: Long, badgeId: Long, sortOrder: Int) : this() {
        id = SeriesStackBadgeId(seriesId, badgeId)
        this.sortOrder = sortOrder
    }
}
