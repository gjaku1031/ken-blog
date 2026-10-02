package io.github.gjaku1031.kenblog.post.dto

/**
 * 초안을 포함한 관리자 태그 사용량
 */
data class TagCountResponse(
    /**
     * 이름
     */
    val name: String,
    /**
     * 개수
     */
    val count: Long
)

/**
 * 본문·게시글 전체 로드 없이 페이지 ID의 태그를 일괄 조회하는 행
 */
data class PostTagRow(
    /**
     * 게시글 ID
     */
    val postId: Long,
    /**
     * 입력 순서의 0 기반 위치
     */
    val position: Int,
    /**
     * 이름
     */
    val name: String
)
