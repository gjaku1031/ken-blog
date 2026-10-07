package io.github.gjaku1031.kenblog.auth.service;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/**
 * 공유 키로 신뢰한 프록시의 출처만 사용, 원문 주소는 저장하지 않고 IPv6는 /64로 묶음
 */
@Component
public final class LoginSource {
    /**
     * 프록시 전용 공유 키, 빈 값이면 직접 주소만 사용
     */
    private final String proxyKey;

    /**
     * 짧은 공유 키로 전달 헤더 신뢰 활성화 거부
     */
    public LoginSource(@Value("${app.auth.proxy-key:}") String proxyKey) {
        if (!proxyKey.isEmpty() && proxyKey.length() < 32)
            throw new IllegalStateException("Authentication proxy key is too short");
        this.proxyKey = proxyKey;
    }

    /**
     * 검증한 숫자 주소를 익명 출처 키로 변환
     */
    public String key(HttpServletRequest request) {
        String supplied = request.getHeader("X-Ken-Blog-Proxy-Key");
        boolean trusted =
                !proxyKey.isEmpty()
                        && MessageDigest.isEqual(
                                proxyKey.getBytes(StandardCharsets.UTF_8),
                                (supplied == null ? "" : supplied)
                                        .getBytes(StandardCharsets.UTF_8));
        String forwarded = trusted ? request.getHeader("X-Ken-Blog-Client-IP") : null;
        String raw =
                forwarded != null && forwarded.length() <= 45 && forwarded.matches("[0-9a-fA-F:.]+")
                        ? forwarded
                        : request.getRemoteAddr();
        byte[] bytes;
        try {
            bytes = InetAddress.getByName(raw).getAddress();
        } catch (UnknownHostException exception) {
            bytes = new byte[0];
        }
        byte[] network = bytes.length == 16 ? Arrays.copyOfRange(bytes, 0, 8) : bytes;
        return AdminAuthSettings.sha256("login-source-v1:" + HexFormat.of().formatHex(network));
    }
}
