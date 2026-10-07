package io.github.gjaku1031.kenblog.post.dto;

import io.github.gjaku1031.kenblog.global.text.Text;
import io.github.gjaku1031.kenblog.post.domain.InvalidWikiLinkRequestException;

import tools.jackson.databind.JsonNode;

import java.util.LinkedHashSet;
import java.util.List;

/**
 * 관리자 명시적 위키 대상 선언의 JSON 타입·문자·개수 검증
 */
public final class WikiDeclarations {
    /**
     * 위키 대상 제목 수 상한
     */
    private static final int MAX_TARGETS = 128;

    /**
     * 정적 선언 검증 전용
     */
    private WikiDeclarations() {}

    /**
     * 위키 대상 제목 배열 검증
     *
     * 1. 생략·null은 유지 신호로 반환, 배열 상한 확인
     * 2. 각 제목을 검증하고 입력 순서대로 중복 제거
     *
     * @param node 선택적 배열 또는 null; 생략과 null은 호출자가 기존 연결 처리에 사용
     * @return 입력 순서로 중복 제거한 제목, 생략·null이면 null
     * @throws InvalidWikiLinkRequestException 항목 수·타입·제목 문자가 잘못됐을 때
     */
    public static List<String> parse(JsonNode node) {
        if (node == null || node.isNull()) return null;
        if (!node.isArray() || node.size() > MAX_TARGETS)
            throw new InvalidWikiLinkRequestException();
        var titles = new LinkedHashSet<String>();
        for (JsonNode value : node) {
            if (!value.isString()) throw new InvalidWikiLinkRequestException();
            titles.add(title(value.stringValue()));
        }
        return List.copyOf(titles);
    }

    /**
     * 양끝 공백 제거 후 1~200 codepoint·위키 구분 문자·제어 문자·surrogate 검사
     */
    public static String title(String raw) {
        String normalized = Text.trim(raw);
        int count = normalized.codePointCount(0, normalized.length());
        if (count < 1
                || count > 200
                || normalized.indexOf('[') >= 0
                || normalized.indexOf(']') >= 0
                || normalized.indexOf('|') >= 0) throw new InvalidWikiLinkRequestException();
        // 코드 포인트 단위로 검사하여 불완전 surrogate도 거부
        for (int offset = 0; offset < normalized.length(); ) {
            int point = normalized.codePointAt(offset);
            if (Character.isISOControl(point)
                    || point == 0x2028
                    || point == 0x2029
                    || point >= 0xD800 && point <= 0xDFFF)
                throw new InvalidWikiLinkRequestException();
            offset += Character.charCount(point);
        }
        return normalized;
    }

    /**
     * 필수 선언 배열의 생략·null 거부
     */
    public static List<String> required(JsonNode node) {
        var result = parse(node);
        if (result == null) throw new InvalidWikiLinkRequestException();
        return result;
    }

    /**
     * 내부 호출에도 같은 개수·제목 제한 적용
     */
    public static List<String> normalized(List<String> titles) {
        if (titles.size() > MAX_TARGETS) throw new InvalidWikiLinkRequestException();
        return titles.stream().map(WikiDeclarations::title).distinct().toList();
    }
}
