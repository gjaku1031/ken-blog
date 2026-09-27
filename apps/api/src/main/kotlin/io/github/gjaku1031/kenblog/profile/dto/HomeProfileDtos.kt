package io.github.gjaku1031.kenblog.profile.dto

/** 관리 폼에서 확정할 홈 소개의 텍스트 필드. */
data class HomeProfileRequest(
    val name: String,
    val tagline: String,
    val intro: String,
    val github: String,
    val email: String,
    val phone: String,
)

/** 방문자가 볼 수 있는 소개와 공개 사진 경로. */
data class HomeProfileResponse(
    val name: String,
    val tagline: String,
    val intro: String,
    val github: String,
    val email: String,
    val phone: String,
    val photoUrl: String?,
)
