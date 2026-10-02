package io.github.gjaku1031.kenblog.attachment.dto

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import org.springframework.http.HttpStatus
import tools.jackson.databind.JsonNode

/**
 * 관리자 JSON의 선택적 이미지 권한 선언을 강제 변환 없이 검증
 */
object AttachmentIds {
    /**
     * 생략·null은 기존 연결 유지 신호로, 명시적 빈 배열은 연결 해제로 구분
     *
     * 최대 100개의 양수 정수 원소만 허용하고 중복을 제거해 잠금 순서대로 반환
     *
     * 1. 생략·null은 기존 연결 유지 신호로 반환
     * 2. 배열 크기와 각 원소의 정수 범위 검사
     * 3. 중복 제거 후 잠금 순서대로 정렬
     *
     * @throws AttachmentFailure 목록 형식·원소·상한이 잘못되었을 때 HTTP 400
     */
    fun parse(node: JsonNode?): List<Long>? {
        // 생략·null은 기존 연결 유지 신호로 반환
        if (node == null || node.isNull) return null
        // 배열 크기와 각 원소의 정수 범위 검사
        if (!node.isArray || node.size() > 100) throw invalid()
        val ids = ArrayList<Long>(node.size())
        for (index in 0 until node.size()) {
            val item = node.get(index)
            if (!item.isIntegralNumber || !item.canConvertToLong() || item.longValue() <= 0) throw invalid()
            ids.add(item.longValue())
        }
        // 중복 제거 후 잠금 순서대로 정렬
        return ids.distinct().sorted()
    }

    /**
     * 첨부 ID 입력 오류 객체 생성
     *
     * @return 입력 원문을 포함하지 않는 HTTP 400용 예외
     */
    private fun invalid(): AttachmentFailure = AttachmentFailure(HttpStatus.BAD_REQUEST, "첨부 ID 목록을 확인하세요.")
}
