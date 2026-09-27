package io.github.gjaku1031.kenblog.post.dto

import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException
import tools.jackson.databind.JsonNode

/** 관리자 읽기 체크박스 변경의 낙관적 본문 조건. */
data class PostTodoRequest(val line: Int, val done: Boolean, val expectedBodySha256: String)

/** 갱신된 원문과 다음 토글에 사용할 해시. */
data class PostTodoResponse(val body: String, val bodySha256: String)

/** 체크박스 JSON 입력을 타입 강제 변환 없이 검증. */
object PostTodoRequests {
    /** @return 1기반 원문 줄과 현재 본문 SHA-256 조건. */
    fun parse(node: JsonNode): PostTodoRequest {
        if (!node.isObject) throw InvalidPostRequestException()
        val line = node.get("line")
        val done = node.get("done")
        val hash = node.get("expectedBodySha256")
        if (line == null || !line.isIntegralNumber || !line.canConvertToInt() || line.intValue() <= 0 ||
            done == null || !done.isBoolean || hash == null || !hash.isTextual ||
            !HASH.matches(hash.textValue())) throw InvalidPostRequestException()
        return PostTodoRequest(line.intValue(), done.booleanValue(), hash.textValue())
    }

    private val HASH = Regex("[0-9a-f]{64}")
}
