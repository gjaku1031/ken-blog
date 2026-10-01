package io.github.gjaku1031.kenblog.mcp.dto

/** 등록 입력은 HTTP와 같은 본문 없는 계약. */
typealias McpPostMetadataInput = io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest

/** 이미지 바이트만 인라인으로 받고 서버 경로·URL은 받지 않는 업로드 입력. */
data class McpImageInput(val filename: String, val mimeType: String, val base64: String)

/** 프로젝트의 사용 중인 로고까지 연결된 기술 뱃지 등록 입력. */
data class McpStackBadgeInput(val name: String, val image: McpImageInput)
