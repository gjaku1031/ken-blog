package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.post.domain.PostSection
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility

/** 조회 집계 전 본문 없이 판정하는 글과 부모 프로젝트의 권한 행. */
data class PostViewAccessRow(val id: Long, val status: PostStatus, val visibility: PostVisibility,
    val section: PostSection, val projectId: Long?, val projectVisibility: PostVisibility?,
    val homeVisibility: PostVisibility?, val homeStatus: PostStatus?, val homeSection: PostSection?,
    val homeId: Long?, val homeProjectId: Long?)

/** 중복 방문을 제외한 현재 저장 조회 수. */
data class PostViewResponse(val viewCount: Long)
