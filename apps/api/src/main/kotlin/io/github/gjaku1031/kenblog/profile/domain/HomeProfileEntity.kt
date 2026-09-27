package io.github.gjaku1031.kenblog.profile.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.LocalDateTime

/** 홈 카드의 확정된 소개와 비공개 OCI 사진 key를 저장하는 단일 행. */
@Entity
@Table(name = "home_profile")
class HomeProfileEntity protected constructor() {
    @Id
    var id: Long = 1
        protected set

    @Column(nullable = false, length = 100)
    var name: String = ""
        protected set

    @Column(nullable = false, length = 240)
    var tagline: String = ""
        protected set

    @Column(nullable = false, columnDefinition = "text")
    var intro: String = ""
        protected set

    @Column(nullable = false, length = 500)
    var github: String = ""
        protected set

    @Column(nullable = false, length = 254)
    var email: String = ""
        protected set

    @Column(nullable = false, length = 40)
    var phone: String = ""
        protected set

    @Column(name = "photo_object_key", length = 255)
    var photoObjectKey: String? = null
        protected set

    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime(6)")
    lateinit var updatedAt: LocalDateTime
        protected set

    /** 첫 편집 시 빈 카드와 수정 시각을 생성. */
    constructor(now: LocalDateTime) : this() { updatedAt = now }

    /** 검증된 텍스트만 확정 카드에 반영. */
    fun update(name: String, tagline: String, intro: String, github: String, email: String, phone: String, now: LocalDateTime) {
        this.name = name
        this.tagline = tagline
        this.intro = intro
        this.github = github
        this.email = email
        this.phone = phone
        updatedAt = now
    }

    /** 새 사진 key를 기록하고 이전 key를 반환. */
    fun replacePhoto(key: String?, now: LocalDateTime): String? = photoObjectKey.also {
        photoObjectKey = key
        updatedAt = now
    }
}
