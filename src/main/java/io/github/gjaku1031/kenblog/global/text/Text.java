package io.github.gjaku1031.kenblog.global.text;

/**
 * Unicode 공백 처리 계약을 공유하는 문자열 도우미
 */
public final class Text {
    /**
     * 정적 문자열 처리 전용
     */
    private Text() {}

    /**
     * Unicode 공백과 공백 구분 문자 여부
     */
    public static boolean isWhitespace(char value) {
        return Character.isWhitespace(value) || Character.isSpaceChar(value);
    }

    /**
     * 앞뒤 Unicode 공백 제거
     */
    public static String trim(String value) {
        int start = 0;
        int end = value.length();
        while (start < end && isWhitespace(value.charAt(start))) start++;
        while (end > start && isWhitespace(value.charAt(end - 1))) end--;
        return value.substring(start, end);
    }

    /**
     * 빈 문자열 또는 Unicode 공백만 있는 값 확인
     */
    public static boolean isBlank(String value) {
        for (int index = 0; index < value.length(); index++) {
            if (!isWhitespace(value.charAt(index))) return false;
        }
        return true;
    }
}
