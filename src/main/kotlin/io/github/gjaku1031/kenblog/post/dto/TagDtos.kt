package io.github.gjaku1031.kenblog.post.dto

/** 관리자 또는 현재 공개 권한에서 읽을 수 있는 글의 태그 사용량. */
data class TagCountResponse(val name: String, val count: Long)

/** 본문·게시글 전체 로드 없이 페이지 ID의 태그를 일괄 조회하는 행. */
data class PostTagRow(val postId: Long, val position: Int, val name: String)
