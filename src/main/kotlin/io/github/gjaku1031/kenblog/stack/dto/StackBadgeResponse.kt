package io.github.gjaku1031.kenblog.stack.dto

/** 등록 기술의 ID·이름과 공개 아이콘 URL. */
data class StackBadgeResponse(val id: Long, val name: String, val imageUrl: String)
