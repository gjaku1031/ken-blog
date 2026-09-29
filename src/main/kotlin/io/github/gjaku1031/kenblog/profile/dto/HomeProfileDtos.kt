package io.github.gjaku1031.kenblog.profile.dto

/** 관리 폼에서 확정할 홈 소개와 공개 연락 이메일의 텍스트 필드. */
data class HomeProfileRequest(
    val name: String,
    val tagline: String,
    val intro: String,
    val github: String,
    val email: String,
)

/** 방문자가 볼 수 있는 소개·연락 이메일과 공개 사진 경로. */
data class HomeProfileResponse(
    val name: String,
    val tagline: String,
    val intro: String,
    val github: String,
    val email: String,
    val photoUrl: String?,
)
