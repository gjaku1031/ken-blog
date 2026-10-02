package io.github.gjaku1031.kenblog.stack.dto

/**
 * 등록 기술의 ID·이름과 공개 아이콘 URL
 */
data class StackBadgeResponse(
    /**
     * ID
     */
    val id: Long,
    /**
     * 이름
     */
    val name: String,
    /**
     * 공개 이미지 URL
     */
    val imageUrl: String
)
