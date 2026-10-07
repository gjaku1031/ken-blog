package io.github.gjaku1031.kenblog.post.domain;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * 옛 DB body_sha256 열의 저장 호환용 계산
 */
public final class PostBodyHash {
    /**
     * 정적 계산 전용
     */
    private PostBodyHash() {}

    /**
     * 본문의 UTF-8 바이트를 해시하며 빈 문자열도 실제 SHA-256을 반환
     *
     * @param body 검증된 원문 본문
     * @return 64자리 소문자 SHA-256 16진수
     */
    public static String sha256(String body) {
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(body.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", exception);
        }
    }
}
