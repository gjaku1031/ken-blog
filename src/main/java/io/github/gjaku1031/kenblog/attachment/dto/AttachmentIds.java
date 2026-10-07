package io.github.gjaku1031.kenblog.attachment.dto;

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure;

import org.springframework.http.HttpStatus;

import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.TreeSet;

/**
 * 관리자 JSON의 선택적 이미지 권한 선언 검증
 */
public final class AttachmentIds {
    /**
     * 정적 입력 검증 전용
     */
    private AttachmentIds() {}

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
    public static List<Long> parse(JsonNode node) {
        if (node == null || node.isNull()) return null;
        if (!node.isArray() || node.size() > 100) throw invalid();
        var ids = new TreeSet<Long>();
        for (JsonNode item : node) {
            if (!item.isIntegralNumber() || !item.canConvertToLong() || item.longValue() <= 0)
                throw invalid();
            ids.add(item.longValue());
        }
        return List.copyOf(ids);
    }

    /**
     * 첨부 ID 입력 오류 객체 생성
     *
     * @return 입력 원문을 포함하지 않는 HTTP 400용 예외
     */
    private static AttachmentFailure invalid() {
        return new AttachmentFailure(HttpStatus.BAD_REQUEST, "첨부 ID 목록을 확인하세요.");
    }
}
