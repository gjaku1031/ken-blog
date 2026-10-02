package io.github.gjaku1031.kenblog.post.domain

import java.security.MessageDigest
import java.util.HexFormat

/** 옛 DB body_sha256 열의 저장 호환용 계산. 파일 조회·HTTP 검증에는 사용하지 않음. */
object PostBodyHash {
    /**
     * 본문의 UTF-8 바이트를 해시하며 빈 문자열도 실제 SHA-256을 반환.
     *
     * @param body 검증된 원문 본문
     * @return 64자리 소문자 SHA-256 16진수
     */
    fun sha256(body: String): String = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body.toByteArray(Charsets.UTF_8)))
}
