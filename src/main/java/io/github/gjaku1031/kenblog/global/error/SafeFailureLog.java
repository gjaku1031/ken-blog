package io.github.gjaku1031.kenblog.global.error;

import jakarta.servlet.http.HttpServletRequest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerMapping;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 입력·SQL·예외 메시지 없이 장애 위치와 연관 ID만 기록
 */
@Component
public final class SafeFailureLog {
    /**
     * 장애 전용 로그 채널
     */
    private final Logger log = LoggerFactory.getLogger(SafeFailureLog.class);

    /**
     * 요청마다 한 번 기록, 원인 최대 4개·앱 프레임 최대 8개
     */
    public String record(HttpServletRequest request, Throwable failure) {
        Object existing = request.getAttribute("kenblog.failure-id");
        if (existing instanceof String id) return id;
        String id = UUID.randomUUID().toString();
        request.setAttribute("kenblog.failure-id", id);
        String method =
                Set.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                                .contains(request.getMethod())
                        ? request.getMethod()
                        : "OTHER";
        Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        String route = pattern == null ? "unmapped" : pattern.toString();
        var causes = new ArrayList<Throwable>();
        for (Throwable cause = failure;
                cause != null && causes.size() < 4;
                cause = cause.getCause()) causes.add(cause);
        String frames =
                causes.stream()
                        .flatMap(cause -> Arrays.stream(cause.getStackTrace()))
                        .filter(
                                frame ->
                                        frame.getClassName()
                                                .startsWith("io.github.gjaku1031.kenblog."))
                        .limit(8)
                        .map(
                                frame ->
                                        frame.getClassName()
                                                + "."
                                                + frame.getMethodName()
                                                + ":"
                                                + frame.getLineNumber())
                        .collect(Collectors.joining(";"));
        log.error(
                "API failure id={} method={} route={} types={} frames={}",
                id,
                method,
                route,
                causes.stream()
                        .map(cause -> cause.getClass().getName())
                        .collect(Collectors.joining(",")),
                frames);
        return id;
    }
}
