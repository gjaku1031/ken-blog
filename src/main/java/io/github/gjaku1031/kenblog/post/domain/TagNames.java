package io.github.gjaku1031.kenblog.post.domain;

import io.github.gjaku1031.kenblog.global.text.Text;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;

/**
 * 게시글 태그와 공개 필터의 Unicode 길이·정규화 계약
 */
public final class TagNames {
    /**
     * 정적 정규화 전용
     */
    private TagNames() {}

    /**
     * 대소문자 무관 중복을 제거하고 최초 표시 철자와 입력 순서 보존
     */
    public static List<String> displayAll(List<String> rawNames) {
        // 검증 완료한 최초 표시 이름을 입력 순서대로 보관
        var names = new LinkedHashMap<String, String>();
        for (String raw : rawNames) {
            String display = Text.trim(raw);
            String canonical = normalize(display);
            if (display.codePointCount(0, display.length()) < 1
                    || display.codePointCount(0, display.length()) > 40) {
                throw new InvalidPostRequestException();
            }
            names.putIfAbsent(canonical, display);
            if (names.size() > 16) throw new InvalidPostRequestException();
        }
        return List.copyOf(names.values());
    }

    /**
     * 앞뒤 공백 제거·ROOT 소문자화 후 1~40 Unicode 문자 및 제어 문자 금지를 확인
     *
     * @param raw 원본 태그명
     * @return 정규화된 정확 일치 태그명
     * @throws InvalidPostRequestException 빈 값·제어 문자·길이 위반일 때
     */
    public static String normalize(String raw) {
        if (raw.chars().anyMatch(Character::isISOControl)) throw new InvalidPostRequestException();
        String name = Text.trim(raw).toLowerCase(Locale.ROOT);
        if (Text.isBlank(name)
                || name.codePointCount(0, name.length()) < 1
                || name.codePointCount(0, name.length()) > 40) {
            throw new InvalidPostRequestException();
        }
        return name;
    }
}
