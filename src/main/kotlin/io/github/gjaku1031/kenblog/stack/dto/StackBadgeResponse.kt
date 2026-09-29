package io.github.gjaku1031.kenblog.stack.dto

/** 공개 아이콘 URL과 프로젝트 사용 수를 포함하는 등록 뱃지. */
data class StackBadgeResponse(val id: Long, val name: String, val imageUrl: String, val projectCount: Long?)

/** 뱃지 이름 변경 요청. */
data class RenameStackBadgeRequest(val name: String)
